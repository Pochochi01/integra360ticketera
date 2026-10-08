const pool = require('../config/db');
const Ticket = require('../models/Ticket');
const Usuario = require('../models/Usuario');
const Transferencia = require('../models/Transferencia');
const Tenant = require('../models/Tenant');
const { enviarImagenTicket } = require('./publicoController');
const { generarCodigo, codigoAImagen } = require('../utils/qr');
const { AppError, asyncHandler } = require('../utils/errors');

/** Solo se expone el QR de tickets válidos (no pendientes de pago, usados ni cancelados). */
const conQr = async (t) => ({ ...t, qr: t.estado === 'valido' ? await codigoAImagen(t.codigo_qr) : null });
const ocultarCodigo = ({ codigo_qr, ...resto }) => resto;

exports.misTickets = asyncHandler(async (req, res) => {
  const tickets = await Ticket.findByUsuario(req.usuario.id_usuario);
  res.json(await Promise.all(tickets.map(conQr)));
});

exports.listar = asyncHandler(async (req, res) => res.json(await Ticket.findAll({ ...req.query, id_tenant: req.tenant.id_tenant })));

exports.detalle = asyncHandler(async (req, res) => {
  const t = await Ticket.findById(req.params.id);
  if (!t) throw new AppError(404, 'Ticket no encontrado');
  const esAdmin = req.usuario.rol === 'superadmin' || (req.usuario.rol === 'admin' && req.usuario.id_tenant === t.id_tenant);
  if (!esAdmin && t.id_usuario !== req.usuario.id_usuario) throw new AppError(403, 'El ticket no le pertenece');
  res.json({ ...(await conQr(t)), transferencias: await Transferencia.findByTicket(t.id_ticket) });
});

/**
 * POST /api/tickets/:id/transferir { email_destino }
 * Reglas: solo el titular, ticket válido (pagado y sin usar), evento futuro y activo,
 * destinatario existente y distinto, respetando el límite por persona del destinatario.
 * Se regenera el código QR: el código anterior queda invalidado (evita duplicados/reventa del mismo QR).
 */
exports.transferir = asyncHandler(async (req, res) => {
  const { email_destino } = req.body;
  if (!email_destino) throw new AppError(400, 'email_destino es obligatorio');

  const ticket = await pool.withTransaction(async (conn) => {
    const t = await Ticket.lockById(req.params.id, conn);
    if (!t) throw new AppError(404, 'Ticket no encontrado');
    if (t.id_usuario !== req.usuario.id_usuario) throw new AppError(403, 'Solo el titular puede transferir el ticket');
    if (t.estado !== 'valido') throw new AppError(409, `No se puede transferir un ticket en estado "${t.estado}"`);
    if (!['publicado', 'agotado'].includes(t.estado_evento) || new Date(t.fecha_evento) < new Date()) {
      throw new AppError(409, 'El evento no admite transferencias');
    }

    const destino = await Usuario.findByEmail(String(email_destino).toLowerCase(), conn);
    if (!destino) throw new AppError(404, 'No existe un usuario con ese email');
    if (destino.id_usuario === t.id_usuario) throw new AppError(400, 'No puede transferirse un ticket a sí mismo');

    await conn.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ? FOR UPDATE', [destino.id_usuario]);
    const [[evento]] = await conn.query('SELECT limite_por_persona FROM eventos WHERE id_evento = ?', [t.id_evento]);
    if (evento.limite_por_persona) {
      const yaTiene = await Ticket.contarActivosUsuarioEvento(destino.id_usuario, t.id_evento, conn);
      if (yaTiene + 1 > evento.limite_por_persona) {
        throw new AppError(409, `El destinatario ya alcanzó el límite de ${evento.limite_por_persona} tickets para este evento`);
      }
    }

    await Ticket.transferir(t.id_ticket, destino.id_usuario, generarCodigo(), conn);
    await Transferencia.create(
      { id_ticket: t.id_ticket, id_usuario_origen: t.id_usuario, id_usuario_destino: destino.id_usuario, codigo_qr_anterior: t.codigo_qr },
      conn
    );
    return Ticket.findById(t.id_ticket, conn);
  });
  res.json({ mensaje: 'Ticket transferido', ticket: ocultarCodigo(ticket) });
});

/** GET /tickets/:id/imagen — PNG de la entrada (imagen del evento + QR) para su titular. */
exports.imagen = asyncHandler(async (req, res) => {
  const t = await Ticket.findById(req.params.id);
  if (!t || t.id_usuario !== req.usuario.id_usuario) throw new AppError(404, 'Ticket no encontrado');
  if (t.estado !== 'valido') throw new AppError(409, `El ticket está ${t.estado}`);
  const tenant = await Tenant.findById(t.id_tenant);
  await enviarImagenTicket(res, t, { tenant: tenant.nombre, color: tenant.config.color_primario, indice: 1, total: 1 });
});

exports.misTransferencias = asyncHandler(async (req, res) => {
  const lista = await Transferencia.findByUsuario(req.usuario.id_usuario);
  res.json(lista.map(({ codigo_qr_anterior, ...r }) => r));
});
