const pool = require('../config/db');
const Tenant = require('../models/Tenant');
const Evento = require('../models/Evento');
const Venta = require('../models/Venta');
const SalesLink = require('../models/SalesLink');
const pagos = require('../services/pagosService');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { urlVenta } = require('../services/salesLinks');
const { limitarPorIp, soloLinkPublico, aplicarProductoDelLink } = require('../middlewares/origenLinkPago');
const { validarCompra } = require('../middlewares/validarCompra');
const linksPago = require('./linksPagoController');
const salesLinks = require('./salesLinksController');
const { ejecutarVenta, liberarVenta } = require('./ventasController');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * POST /api/ventas/checkout — punto de entrada ÚNICO para cobrar con MercadoPago, sea cual sea el canal:
 *
 *   { event_id, items: [{ id_tipo, cantidad }], comprador }     venta directa (página del evento o panel del admin)
 *   { codigo_link | link_id, items?, comprador }                link de un vendedor (/checkout/:linkId)
 *   { linkId, cantidad?, comprador }                            link compartido del complejo (/venta/:linkId)
 *   comprador = { nombre, email, telefono }
 *
 * Todos terminan en el mismo núcleo: ventasController.ejecutarVenta (valida stock del evento SIN descontarlo)
 * + pagosService.preferenciaDeVenta (access token OAuth del complejo del evento) → { init_point }.
 * El stock del evento se descuenta sólo cuando MercadoPago aprueba el pago (webhook → confirmarStockDeVenta).
 * El complejo sale siempre del evento / link, nunca del cuerpo: un tenant_id distinto se rechaza con 403.
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Venta directa: el evento identifica al complejo. Sólo MercadoPago, comprador sin cuenta. */
const cargarEvento = asyncHandler(async (req, _res, next) => {
  limitarPorIp(req.ip);
  const evento = await Evento.findById(Number(req.body.event_id));
  if (!evento) throw new AppError(404, 'Evento no encontrado');
  if (req.body.tenant_id !== undefined && Number(req.body.tenant_id) !== evento.id_tenant) throw new AppError(403, 'El complejo no corresponde al evento');
  req.tenant = await Tenant.findById(evento.id_tenant);
  req.origenPublico = true; // email obligatorio (comprobante de MercadoPago)
  req.body.id_evento = evento.id_evento;
  req.body.metodo_pago = 'mercadopago';
  // Compra desde el QR de la puerta (/comprar/...): sólo ese origen se acepta desde afuera
  req.origenVenta = req.body.origen === 'puerta_qr' ? 'puerta_qr' : null;
  next();
});

/** Reserva sin descontar stock + preferencia en la cuenta del complejo → { init_point }. */
const crear = asyncHandler(async (req, res) => {
  const link = req.salesLink || null;
  // Link reutilizable de un vendedor: la venta (y sus tickets) quedan atribuidas a él → «Mis ventas» y estadísticas
  if (link?.seller_id) req.compra.vendedor = { id_vendedor: link.seller_id, id_link: null };
  if (req.origenVenta) req.compra.origen = req.origenVenta;
  // Un link del complejo fija su precio (puede diferir del precio de lista del tipo de entrada)
  if (link) req.compra.total = Math.round(Number(link.precio) * req.compra.cantidadTotal * 100) / 100;

  const minutos = Number(process.env.LINK_COMPRADOR_RESERVA_MIN || 30);
  const vence = Math.min(Date.now() + minutos * 60 * 1000, new Date(req.compra.evento.fecha).getTime());
  const { venta, tickets } = await ejecutarVenta(req.compra, { expiraEn: new Date(vence) });

  let pref;
  try {
    if (link) await SalesLink.vincularVenta(venta.id_venta, link.id, req.compra.cantidadTotal);
    const cp = req.body.comprador || {};
    pref = await pagos.preferenciaDeVenta(venta, link ? tickets.map((t) => ({ ...t, precio: Number(link.precio) })) : tickets, {
      pagador: { nombre: cp.nombre?.trim(), apellido: cp.apellido?.trim(), email: cp.email?.trim().toLowerCase(), telefono: req.body.whatsapp },
      retorno: `${frontend()}/entrada/${venta.token_acceso}`,
      // Pago rechazado: vuelve a la página desde la que compró para reintentar
      fallo: link ? `${urlVenta(link.id)}?pago=rechazado`
        : req.linkVenta ? `${frontend()}/checkout/${req.linkVenta.codigo}?pago=rechazado`
          : req.origenVenta ? `${frontend()}/comprar/evento/${venta.id_evento}?pago=rechazado`
            : `${frontend()}/eventos/${venta.id_evento}?pago=rechazado`,
    });
  } catch (e) {
    // Sin preferencia no hay cómo pagar: se cancela la reserva (no retenía stock, pero sí asientos)
    await pool.withTransaction(async (conn) => liberarVenta(conn, await Venta.lockById(venta.id_venta, conn), 'cancelado'));
    throw e.status ? e : new AppError(502, `MercadoPago no pudo generar el pago: ${e.message}`);
  }
  // Cuenta conectada con credenciales de prueba → checkout sandbox
  const cuenta = await MercadoPagoToken.publica(venta.id_tenant);
  const initPoint = cuenta && !cuenta.live_mode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
  res.status(201).json({ init_point: initPoint, url: initPoint, id_venta: venta.id_venta, monto_total: Number(venta.monto_total), cantidad: req.compra.cantidadTotal, canal: req.canal });
});

/** Cadenas por canal; validarCompra y resolverComprador son las mismas para todos. */
const CADENAS = {
  link_complejo: [salesLinks.cargarLink, linksPago.resolverComprador, validarCompra('link'), crear],
  vendedor: [soloLinkPublico, linksPago.verificarAlcance, aplicarProductoDelLink, linksPago.resolverComprador, validarCompra('vendedor'), crear],
  directa: [cargarEvento, linksPago.resolverComprador, validarCompra('link'), crear],
};

const canalDe = (b = {}) => {
  if (b.linkId || b.sales_link_id) return 'link_complejo';
  if (b.codigo_link || b.link_id) return 'vendedor';
  if (b.event_id) return 'directa';
  return null;
};

/** Elige la cadena del canal y la ejecuta en orden (como un mini-router). */
const checkout = (req, res, next) => {
  const canal = canalDe(req.body);
  if (!canal) return next(new AppError(400, 'Indicá el evento (event_id) o el link de venta'));
  if (canal === 'link_complejo' && !req.body.linkId) req.body.linkId = req.body.sales_link_id;
  req.canal = canal;
  const cadena = [...CADENAS[canal]];
  const siguiente = (err) => (err ? next(err) : cadena.length ? cadena.shift()(req, res, siguiente) : next());
  return siguiente();
};

module.exports = { checkout, crear, cargarEvento, canalDe };
