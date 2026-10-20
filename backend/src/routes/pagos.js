const { Router } = require('express');
const { seleccionarMercadoPago } = require('../middlewares/integraciones');
const c = require('../controllers/pagosController');

// Webhooks de MercadoPago (sin JWT: se validan con firma + consulta del pago a la API)
const r = Router();
// URL única para configurar en la aplicación de MercadoPago (identifica el complejo por user_id)
r.post('/webhook', c.webhook);
// URL por complejo / plataforma: la que va en la notification_url de cada preferencia
r.post('/webhook/mercadopago/:ambito', seleccionarMercadoPago('webhook'), c.webhookMercadoPago);

module.exports = r;
