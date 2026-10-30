const Tenant = require('../models/Tenant');
const SalesLink = require('../models/SalesLink');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { crearSalesLink, datosVenta, disponible, conUrl } = require('../services/salesLinks');
const { limitarPorIp } = require('../middlewares/origenLinkPago');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * Links de venta del administrador (ver services/salesLinks.js).
 *
 *  POST  /api/ventas/link              (admin) { id_tipo, stock_total, reutilizable?, precio?, producto?, tenant_id? }
 *  GET   /api/ventas/link              (admin) links del complejo con stock y ventas
 *  PATCH /api/ventas/link/:id          (admin) { activo }
 *  GET   /api/ventas/link/:id/tickets  (admin) compras del link con su estado (approved | pending | rejected …)
 *  GET   /api/publico/venta/:linkId    datos de la página pública
 *  POST  /api/ventas/checkout          { linkId, cantidad?, comprador } → { init_point }  (ver checkoutController)
 */
/** POST /api/ventas/link — tenant_id sale del JWT; si viene en el cuerpo debe coincidir. */
exports.crear = asyncHandler(async (req, res) => {
  if (req.body.tenant_id !== undefined && Number(req.body.tenant_id) !== req.tenant.id_tenant) {
    throw new AppError(403, 'El complejo no corresponde a tu sesión');
  }
  const link = await crearSalesLink({ tenant: req.tenant, usuario: req.usuario, ...req.body });
  const cuenta = await MercadoPagoToken.publica(req.tenant.id_tenant);
  res.status(201).json({
    ...link, mensaje: 'Link de venta generado',
    aviso: cuenta?.conectado && cuenta.activo ? link.aviso : 'El complejo no tiene MercadoPago conectado: el link no va a poder cobrar hasta conectarlo',
  });
});

exports.listar = asyncHandler(async (req, res) => res.json((await SalesLink.findByTenant(req.tenant.id_tenant)).map(conUrl)));

exports.actualizar = asyncHandler(async (req, res) => {
  const [r] = await SalesLink.setActivo(req.params.id, req.tenant.id_tenant, Boolean(req.body.activo));
  if (!r.affectedRows) throw new AppError(404, 'Link no encontrado');
  res.json(conUrl(await SalesLink.findById(req.params.id)));
});

exports.tickets = asyncHandler(async (req, res) => res.json(await SalesLink.tickets(req.params.id, req.tenant.id_tenant)));

exports.verPublico = asyncHandler(async (req, res) => res.json(await datosVenta(req.params.linkId)));

/**
 * Checkout por link del complejo: identifica el link y arma el pedido. El complejo sale del link, nunca del cuerpo.
 * Controla disponibilidad y stock del link, pero NO lo descuenta: eso ocurre al aprobarse el pago.
 */
exports.cargarLink = asyncHandler(async (req, _res, next) => {
  limitarPorIp(req.ip);
  const id = String(req.body.linkId || req.body.link_id || '');
  const link = id && (await SalesLink.findById(id));
  if (!link) throw new AppError(404, 'Este link de venta no existe');
  if (!link.activo) throw new AppError(409, 'El link de venta está pausado');
  if (link.seller_id && link.estado_vendedor !== 'activo') throw new AppError(409, 'El vendedor de este link no está activo');
  if (!disponible(link)) throw new AppError(409, link.reutilizable ? 'Se agotaron las entradas de este link' : 'Este link ya fue utilizado');
  if (req.body.tenant_id !== undefined && Number(req.body.tenant_id) !== link.tenant_id) throw new AppError(403, 'El complejo no corresponde al link');

  const cantidad = link.reutilizable ? Number(req.body.cantidad || 1) : link.stock_total;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw new AppError(400, 'La cantidad debe ser un entero entre 1 y 50');
  if (cantidad > link.stock_disponible) throw new AppError(409, 'No hay entradas suficientes para esa cantidad: probá con menos'); // sin revelar el stock al comprador

  req.tenant = await Tenant.findById(link.tenant_id);
  req.salesLink = link;
  req.origenPublico = true; // email obligatorio en resolverComprador
  req.body.id_evento = link.id_evento;
  req.body.items = [{ id_tipo: link.id_tipo, cantidad }];
  req.body.metodo_pago = 'mercadopago';
  next();
});
