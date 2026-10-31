const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const Usuario = require('../models/Usuario');
const Venta = require('../models/Venta');
const pagos = require('./pagosService');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { ticketsConLink } = require('./correo');
const { AppError } = require('../utils/errors');

/**
 * Venta en portería digital. No hay un flujo de pago nuevo: todo pasa por el mismo núcleo que el resto de los
 * canales (validarCompra → ejecutarVenta → preferencia con el token del complejo → webhook → confirmarStockDeVenta
 * → tickets habilitados + correo/WhatsApp). Acá sólo vive lo propio de la puerta:
 *
 *  - Compra por QR (/comprar/evento/:id, /comprar/:id/:tipo): datos para la landing de compra rápida. El pago lo
 *    hace POST /api/ventas/checkout con { event_id, origen: 'puerta_qr' }.
 *  - Cobro asistido en boletería (/admin/porteros/venta): el staff genera el cobro y muestra el QR de pago; el
 *    cliente paga desde su celular y la pantalla del staff confirma sola (consulta el estado cada 2 s).
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Slug de un tipo de entrada para la URL: «Early Bird» → earlybird, «Last Chance» → lastchance. */
const slugTipo = (nombre) => String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const urlCompra = (idEvento, tipo = null) => (tipo ? `${frontend()}/comprar/${idEvento}/${slugTipo(tipo.nombre_tipo)}` : `${frontend()}/comprar/evento/${idEvento}`);

/** Tipos que se pueden comprar ahora mismo (activos, no administrativos, dentro de su ventana de venta). */
const tiposVendibles = async (idEvento) => {
  const ahora = new Date();
  return (await TipoTicket.findByEvento(idEvento)).filter((t) =>
    (!t.venta_desde || new Date(t.venta_desde) <= ahora) && (!t.venta_hasta || new Date(t.venta_hasta) >= ahora));
};

/**
 * GET /api/publico/comprar/:idEvento[/:tipo] — datos de la landing. Con :tipo devuelve sólo ese tipo (compra en
 * un paso). La disponibilidad se informa como estado (disponible / últimas N / agotado), no como stock exacto.
 */
const datosCompraRapida = async (idEvento, slug = null) => {
  const evento = await Evento.findById(Number(idEvento));
  if (!evento || evento.estado_tenant !== 'activo') throw new AppError(404, 'Evento no encontrado');
  const [[t]] = await pool.query('SELECT nombre, logo_url, color_primario, direccion FROM tenants WHERE id_tenant = ?', [evento.id_tenant]);
  let tipos = await tiposVendibles(evento.id_evento);
  if (slug) {
    tipos = tipos.filter((tp) => slugTipo(tp.nombre_tipo) === String(slug).toLowerCase());
    if (!tipos.length) throw new AppError(404, 'Ese tipo de entrada no está a la venta');
  }
  const cuenta = await MercadoPagoToken.publica(evento.id_tenant);
  const vendible = evento.estado === 'publicado' && new Date(String(evento.fecha).replace(' ', 'T')) > new Date(Date.now() - 6 * 3600 * 1000);
  return {
    evento: {
      id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar,
      imagen_evento: evento.imagen_evento, limite_por_persona: evento.limite_por_persona, tiene_seating: Boolean(evento.tiene_seating),
    },
    complejo: { nombre: t.nombre, logo_url: t.logo_url, color: t.color_primario, direccion: t.direccion },
    tipos: tipos.map((tp) => ({
      id_tipo: tp.id_tipo, nombre: tp.nombre_tipo, slug: slugTipo(tp.nombre_tipo), condiciones: tp.condiciones,
      precio: Number(tp.precio), disponible: tp.stock_disponible > 0,
      quedan: tp.stock_disponible > 0 && tp.stock_disponible <= 20 ? tp.stock_disponible : null,
      maximo: Math.min(tp.stock_disponible, evento.limite_por_persona || 10, 10),
    })),
    // Con asientos numerados hay que elegir butaca: la compra rápida no aplica
    vendible: vendible && !evento.tiene_seating,
    motivo: evento.tiene_seating ? 'seating' : !vendible ? (evento.estado === 'agotado' ? 'agotado' : 'no_disponible') : null,
    mercadopago_disponible: Boolean(cuenta?.conectado && cuenta.activo),
  };
};

/** QR de compra del evento (general y por tipo) para el panel del organizador. */
const qrsDeCompra = async (idEvento, idTenant) => {
  const evento = await Evento.findById(Number(idEvento));
  if (!evento || evento.id_tenant !== idTenant) throw new AppError(404, 'Evento no encontrado');
  const tipos = (await TipoTicket.findByEvento(evento.id_evento)).filter((t) => t.activo && !t.solo_admin);
  return {
    evento: { id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar, estado: evento.estado, tiene_seating: Boolean(evento.tiene_seating) },
    general: { url: urlCompra(evento.id_evento) },
    por_tipo: tipos.map((t) => ({ id_tipo: t.id_tipo, nombre: t.nombre_tipo, precio: Number(t.precio), slug: slugTipo(t.nombre_tipo), url: urlCompra(evento.id_evento, t) })),
  };
};

/**
 * Comprador del cobro asistido. Con nombre y teléfono se identifica como siempre (y recibe la entrada por correo
 * / WhatsApp); sin datos se crea un comprador anónimo «Cliente en puerta» para esa venta: la entrada le llega al
 * celular al volver de MercadoPago (/entrada/:token) y además se ve en la pantalla de la boletería.
 */
const compradorAnonimo = async () => Usuario.create({
  nombre: 'Cliente', apellido: 'en puerta', email: null, whatsapp: null, rol: 'comprador',
  password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
});

const MINUTOS_COBRO = () => Number(process.env.PUERTA_COBRO_MIN || 15);

/** Crea la venta (sin descontar stock) y la preferencia; devuelve el QR de pago para mostrar en pantalla. */
const crearCobroAsistido = async (req) => {
  const { ejecutarVenta, liberarVenta } = require('../controllers/ventasController'); // diferido: dependencia circular
  req.compra.origen = 'puerta_asistida';
  const vence = Math.min(Date.now() + MINUTOS_COBRO() * 60 * 1000, new Date(req.compra.evento.fecha).getTime() + 6 * 3600 * 1000);
  const { venta, tickets } = await ejecutarVenta(req.compra, { expiraEn: new Date(vence) });
  let pref;
  try {
    const cp = req.body.comprador || {};
    pref = await pagos.preferenciaDeVenta(venta, tickets, {
      pagador: cp.nombre ? { nombre: cp.nombre.trim(), email: cp.email?.trim().toLowerCase(), telefono: req.body.whatsapp } : undefined,
      // El cliente vuelve de MercadoPago a su entrada (en su celular)
      retorno: `${frontend()}/entrada/${venta.token_acceso}`,
      fallo: `${frontend()}/entrada/${venta.token_acceso}`,
    });
  } catch (e) {
    await pool.withTransaction(async (conn) => liberarVenta(conn, await Venta.lockById(venta.id_venta, conn), 'cancelado'));
    throw e.status ? e : new AppError(502, `MercadoPago no pudo generar el cobro: ${e.message}`);
  }
  const cuenta = await MercadoPagoToken.publica(venta.id_tenant);
  const initPoint = cuenta && !cuenta.live_mode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
  return {
    id_venta: venta.id_venta, init_point: initPoint, monto_total: Number(venta.monto_total), cantidad: req.compra.cantidadTotal,
    expira_en: new Date(vence).toISOString(),
    qr_pago: await QRCode.toDataURL(initPoint, { width: 360, margin: 1, errorCorrectionLevel: 'M' }),
  };
};

/** Estado de un cobro para la pantalla de boletería (consulta cada 2 s). Con el pago aprobado trae las entradas. */
const estadoCobro = async (idVenta, idTenant) => {
  const venta = await Venta.findById(Number(idVenta));
  if (!venta || venta.id_tenant !== idTenant) throw new AppError(404, 'Cobro no encontrado');
  const estadoPago = venta.estado === 'pagado' ? 'approved'
    : venta.estado === 'cancelado' ? 'cancelled' : venta.estado === 'reembolsado' ? 'refunded'
      : venta.estado_ultimo_pago === 'rechazado' ? 'rejected' : 'pending';
  const base = { id_venta: venta.id_venta, estado: venta.estado, estado_pago: estadoPago, monto_total: Number(venta.monto_total), expira_en: venta.expira_en, comprador: venta.comprador };
  if (venta.estado !== 'pagado') return base;
  const tickets = await ticketsConLink(venta.id_venta);
  return { ...base, entrada_url: `${frontend()}/entrada/${venta.token_acceso}`, tickets: tickets.map((t) => ({ id_ticket: t.id_ticket, numero: t.numero, tipo: t.nombre_tipo, url: t.url })) };
};

module.exports = { datosCompraRapida, qrsDeCompra, crearCobroAsistido, estadoCobro, compradorAnonimo, slugTipo, urlCompra };
