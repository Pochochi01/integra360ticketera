const { Router } = require('express');
const { seleccionarMercadoPago } = require('../middlewares/integraciones');
const c = require('../controllers/pagosController');

// Webhooks de MercadoPago (sin JWT: se validan con firma + consulta del pago a la API)
const r = Router();
r.post('/webhook/mercadopago/:ambito', seleccionarMercadoPago('webhook'), c.webhookMercadoPago);

module.exports = r;
