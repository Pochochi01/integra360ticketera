const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const ListaEspera = require('../models/ListaEspera');
const { AppError } = require('../utils/errors');

/**
 * Edición de un evento por el admin del complejo (POST /api/admin/event/:id/update), en UNA transacción:
 *
 *   { nombre?, fecha?, lugar?, descripcion?, limite_por_persona?,
 *     agregar_stock?: [{ id_tipo, cantidad }] }      cantidad > 0: suma a stock_total y stock_disponible
 *
 * Reglas de integridad:
 *  - El stock sólo se AGREGA (nunca se resta): las entradas vendidas no se tocan. Para corregir un cupo a la
 *    baja está la edición del tipo, que no deja bajar de lo vendido.
 *  - Evento cancelado o finalizado: no se edita. La fecha nueva debe ser futura.
 *  - Los tipos deben ser del evento. Filas bloqueadas (FOR UPDATE): un pago aprobado al mismo tiempo, que
 *    descuenta stock, no se pisa (el ajuste es relativo).
 *  - Cada cambio queda en auditoria_eventos con quién, cuándo y los valores antes / después.
 *  - Si el evento estaba agotado y se agregan entradas, vuelve a 'publicado' y se avisa a la lista de espera.
 */
const CAMPOS = ['nombre', 'fecha', 'lugar', 'descripcion', 'limite_por_persona'];
const MAX_AGREGAR = 100000;

const normalizar = (campo, v) => {
  if (campo === 'limite_por_persona') return v ? Number(v) : null;
  if (campo === 'nombre' || campo === 'lugar') return String(v).trim();
  return v;
};
const comparable = (v) => (v === undefined || v === null ? '' : v instanceof Date ? v.toISOString() : String(v));
// Las fechas se comparan al minuto: el formulario no manda segundos y no debe auditarse un cambio que no hubo
const minuto = (f) => Math.floor(new Date(String(f).replace(' ', 'T')).getTime() / 60000);
const distinto = (campo, antes, despues) => (campo === 'fecha' ? minuto(antes) !== minuto(despues) : comparable(antes) !== comparable(despues));

const auditar = (conn, idEvento, usuario, accion, detalle) =>
  conn.query('INSERT INTO auditoria_eventos (id_evento, id_usuario, accion, detalle) VALUES (?, ?, ?, ?)',
    [idEvento, usuario.id_usuario, accion, JSON.stringify(detalle)]);

/** Evento con tipos, stock total y últimos cambios auditados (para el panel). */
const detalleAdmin = async (idEvento) => {
  const evento = await Evento.findById(idEvento);
  if (!evento) return null;
  const tipos = await TipoTicket.findByEvento(idEvento, { incluirSoloAdmin: true });
  const [auditoria] = await pool.query(
    `SELECT a.id, a.accion, a.detalle, a.creado_en, CONCAT_WS(' ', u.nombre, u.apellido) AS usuario
       FROM auditoria_eventos a LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
      WHERE a.id_evento = ? ORDER BY a.creado_en DESC, a.id DESC LIMIT 20`, [idEvento]);
  const vendibles = tipos.filter((t) => t.activo && !t.solo_admin);
  return {
    ...evento,
    tipos,
    stock_total: vendibles.reduce((s, t) => s + t.stock_total, 0),
    stock_disponible: vendibles.reduce((s, t) => s + t.stock_disponible, 0),
    auditoria: auditoria.map((a) => ({ ...a, detalle: typeof a.detalle === 'string' ? JSON.parse(a.detalle) : a.detalle })),
  };
};

const actualizarEvento = async ({ idEvento, tenant, usuario, cambios, validarEvento }) => {
  const datos = Object.fromEntries(CAMPOS.filter((c) => cambios[c] !== undefined).map((c) => [c, cambios[c]]));
  validarEvento(datos, true);
  if (datos.fecha && new Date(datos.fecha) <= new Date()) throw new AppError(400, 'La fecha del evento debe ser futura');

  const agregados = Array.isArray(cambios.agregar_stock) ? cambios.agregar_stock : [];
  for (const a of agregados) {
    const n = Number(a.cantidad);
    if (!Number.isInteger(n) || n < 1 || n > MAX_AGREGAR) {
      throw new AppError(400, `La cantidad a agregar debe ser un entero entre 1 y ${MAX_AGREGAR} (el stock no se puede descontar)`);
    }
  }
  if (!Object.keys(datos).length && !agregados.length) throw new AppError(400, 'No hay cambios para guardar');

  const liberados = [];
  await pool.withTransaction(async (conn) => {
    const [[evento]] = await conn.query('SELECT * FROM eventos WHERE id_evento = ? FOR UPDATE', [idEvento]);
    if (!evento || evento.id_tenant !== tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
    if (['cancelado', 'finalizado'].includes(evento.estado)) throw new AppError(409, `El evento está ${evento.estado}`);

    // Datos del evento: sólo lo que cambia, con auditoría de antes / después
    const diferencias = {};
    for (const [c, v] of Object.entries(datos)) {
      const nuevo = normalizar(c, v);
      if (distinto(c, evento[c], nuevo)) diferencias[c] = { antes: evento[c], despues: nuevo };
    }
    if (Object.keys(diferencias).length) {
      await conn.query(`UPDATE eventos SET ${Object.keys(diferencias).map((c) => `${c} = ?`).join(', ')} WHERE id_evento = ?`,
        [...Object.values(diferencias).map((d) => d.despues), idEvento]);
      await auditar(conn, idEvento, usuario, 'editar_evento', diferencias);
    }

    // Más entradas: suma relativa sobre filas bloqueadas
    if (agregados.length) {
      const ids = [...new Set(agregados.map((a) => Number(a.id_tipo)))];
      const tipos = new Map((await TipoTicket.lockByIds(ids, conn)).map((t) => [t.id_tipo, t]));
      for (const a of agregados) {
        const tipo = tipos.get(Number(a.id_tipo));
        if (!tipo || tipo.id_evento !== idEvento) throw new AppError(400, `El tipo de entrada ${a.id_tipo} no pertenece al evento`);
        const n = Number(a.cantidad);
        await TipoTicket.agregarStock(tipo.id_tipo, n, conn);
        await auditar(conn, idEvento, usuario, 'agregar_stock', {
          id_tipo: tipo.id_tipo, tipo: tipo.nombre_tipo, cantidad: n,
          stock_total: { antes: tipo.stock_total, despues: tipo.stock_total + n },
          stock_disponible: { antes: tipo.stock_disponible, despues: tipo.stock_disponible + n },
        });
        tipo.stock_total += n;
        tipo.stock_disponible += n;
        liberados.push([tipo.id_tipo, n]);
      }
      await Evento.actualizarEstadoPorStock(idEvento, conn); // agotado → publicado
    }
  });
  // Avisos a la lista de espera fuera de la transacción (envían mensajes)
  for (const [idTipo, n] of liberados) await ListaEspera.notificarLiberacion(idTipo, n).catch(() => {});

  return detalleAdmin(idEvento);
};

module.exports = { actualizarEvento, detalleAdmin };
