const { Router } = require('express');
const { soloVendedor } = require('../middlewares/tenant');
const { origenLinkPago, aplicarProductoDelLink } = require('../middlewares/origenLinkPago');
const { validarCompra } = require('../middlewares/validarCompra');
const c = require('../controllers/linksPagoController');

/**
 * Links de pago (montado en /api/links).
 *
 * POST /generar — sin body.comprador (vendedor): genera un link de checkout /checkout/:linkId.
 *   Con body.comprador, dos orígenes (ver middlewares/origenLinkPago.js):
 *   · el vendedor con sesión arma la compra de un cliente (MercadoPago o efectivo)
 *   · el comprador, sin cuenta, desde el link de venta del vendedor (body.codigo_link): completa sus
 *     datos, se crea la preferencia con la cuenta del complejo y el frontend lo redirige al init_point
 * Cadena: origen → tenant_id / seller_id del servidor → comprador → validación de la compra → reserva + link.
 */
const r = Router();
r.post('/generar', origenLinkPago, c.verificarAlcance, c.ramificar, aplicarProductoDelLink, c.resolverComprador, validarCompra('vendedor'), c.generar);
r.get('/', soloVendedor, c.listar);

module.exports = r;
