const Tenant = require('../models/Tenant');
const LinkVenta = require('../models/LinkVenta');
const { soloVendedor } = require('./tenant');
const { AppError } = require('../utils/errors');

/**
 * Origen de un pedido a POST /api/links/generar. Deja en req.tenant y req.vendedor el complejo y el
 * vendedor; los toma SIEMPRE del servidor, nunca de tenant_id / seller_id del cuerpo:
 *
 *  - Vendedor con sesión (Authorization: Bearer …): JWT → vendedor activo de su complejo.
 *  - Comprador sin cuenta (body.codigo_link): el link de venta del vendedor identifica al vendedor y a
 *    su complejo. Sólo MercadoPago (el efectivo lo reserva el vendedor) y con límite de pedidos por IP.
 */
const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_VENTANA = Number(process.env.LINK_PUBLICO_MAX_POR_IP || 15);
const pedidos = new Map(); // ip → timestamps

const limitarPorIp = (ip) => {
  const ahora = Date.now();
  const recientes = (pedidos.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= MAX_POR_VENTANA) throw new AppError(429, 'Demasiados intentos. Esperá unos minutos y volvé a intentar.');
  pedidos.set(ip, [...recientes, ahora]);
  if (pedidos.size > 10_000) pedidos.clear(); // evita crecer sin límite
};

const desdeLinkPublico = async (req, _res, next) => {
  try {
    limitarPorIp(req.ip);
    const link = await LinkVenta.findByCodigo(String(req.body.codigo_link || ''));
    if (!link || !link.activo || link.estado_vendedor !== 'activo' || link.estado_tenant !== 'activo') {
      throw new AppError(409, 'El link de venta no está activo');
    }
    if (link.id_evento && req.body.id_evento && Number(req.body.id_evento) !== link.id_evento) throw new AppError(409, 'El link de venta es de otro evento');
    if (link.id_evento) req.body.id_evento = link.id_evento;
    req.tenant = await Tenant.findById(link.id_tenant);
    req.vendedor = { id_vendedor: link.id_vendedor };
    req.linkVenta = link;
    req.origenPublico = true;
    if (req.body.tipo_pago && req.body.tipo_pago !== 'mercadopago') throw new AppError(403, 'Desde el link sólo se puede pagar con MercadoPago');
    req.body.tipo_pago = 'mercadopago';
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Aplica el producto que fija el link (tipo de entrada y/o cantidad): el comprador no puede cambiarlo.
 * Sólo actúa en pedidos que llegan por un link (req.linkVenta).
 */
const aplicarProductoDelLink = (req, _res, next) => {
  const link = req.linkVenta;
  if (!link) return next();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (link.id_tipo && link.cantidad) {
    req.body.items = [{ id_tipo: link.id_tipo, cantidad: link.cantidad }];
  } else if (link.id_tipo) {
    if (items.some((i) => Number(i.id_tipo) !== link.id_tipo)) return next(new AppError(409, 'Este link sólo vende el tipo de entrada indicado por el vendedor'));
  } else if (link.cantidad) {
    const total = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
    if (total !== link.cantidad) return next(new AppError(409, `Este link es para ${link.cantidad} entrada(s)`));
  }
  next();
};

/** Sólo por link de venta (página /checkout/:linkId): ignora cualquier sesión del navegador. */
const soloLinkPublico = (req, res, next) => {
  if (!req.body?.codigo_link && req.body?.link_id) req.body.codigo_link = req.body.link_id;
  if (!req.body?.codigo_link) return next(new AppError(400, 'Falta el link de pago (link_id)'));
  return desdeLinkPublico(req, res, next);
};

/** Elige la cadena según haya sesión o código de link. */
const origenLinkPago = (req, res, next) => {
  if (req.headers.authorization) {
    // Ejecuta la cadena soloVendedor (verificarToken → rol → tenant → vendedor activo)
    const cadena = [...soloVendedor];
    const siguiente = (err) => (err ? next(err) : cadena.length ? cadena.shift()(req, res, siguiente) : next());
    return siguiente();
  }
  if (req.body?.codigo_link) return desdeLinkPublico(req, res, next);
  next(new AppError(401, 'Iniciá sesión como vendedor o abrí el link de venta del vendedor'));
};

module.exports = { origenLinkPago, soloLinkPublico, aplicarProductoDelLink };
