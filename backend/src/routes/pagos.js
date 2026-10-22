const { Router } = require('express');
const { seleccionarMercadoPago } = require('../middlewares/integraciones');
const c = require('../controllers/pagosController');
const { checkout } = require('../controllers/checkoutController');
const { AppError } = require('../utils/errors');

const r = Router();

/**
 * POST /api/pagos/crear — el comprador envía el formulario de /checkout/:linkId.
 *   { link_id, id_evento?, items: [{ id_tipo, cantidad }], comprador: { nombre, email, telefono } }
 * El link identifica al vendedor y a su complejo; la preferencia se crea con el access token OAuth de
 * ESE complejo y se devuelve el init_point para redirigir (window.location.href = init_point).
 */
// Alias histórico del link de vendedor: usa el mismo checkout único que /api/ventas/checkout
r.post('/crear', (req, _res, next) => { if (!req.body?.codigo_link && !req.body?.link_id) return next(new AppError(400, 'Falta el link de pago (link_id)')); next(); }, checkout);

// Webhooks de MercadoPago (sin JWT: se validan con firma + consulta del pago a la API)
// URL única para configurar en la aplicación de MercadoPago (identifica el complejo por user_id)
r.post('/webhook', c.webhook);
// URL por complejo / plataforma: la que va en la notification_url de cada preferencia
r.post('/webhook/mercadopago/:ambito', seleccionarMercadoPago('webhook'), c.webhookMercadoPago);

module.exports = r;
