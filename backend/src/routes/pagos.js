const { Router } = require('express');
const { seleccionarMercadoPago } = require('../middlewares/integraciones');
const c = require('../controllers/pagosController');
const links = require('../controllers/linksPagoController');
const { soloLinkPublico, aplicarProductoDelLink } = require('../middlewares/origenLinkPago');
const { validarCompra } = require('../middlewares/validarCompra');

const r = Router();

/**
 * POST /api/pagos/crear — el comprador envía el formulario de /checkout/:linkId.
 *   { link_id, id_evento?, items: [{ id_tipo, cantidad }], comprador: { nombre, email, telefono } }
 * El link identifica al vendedor y a su complejo; la preferencia se crea con el access token OAuth de
 * ESE complejo y se devuelve el init_point para redirigir (window.location.href = init_point).
 */
r.post('/crear', soloLinkPublico, links.verificarAlcance, aplicarProductoDelLink, links.resolverComprador, validarCompra('vendedor'), links.generar);

// Webhooks de MercadoPago (sin JWT: se validan con firma + consulta del pago a la API)
// URL única para configurar en la aplicación de MercadoPago (identifica el complejo por user_id)
r.post('/webhook', c.webhook);
// URL por complejo / plataforma: la que va en la notification_url de cada preferencia
r.post('/webhook/mercadopago/:ambito', seleccionarMercadoPago('webhook'), c.webhookMercadoPago);

module.exports = r;
