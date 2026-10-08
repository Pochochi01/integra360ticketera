const { Router } = require('express');
const { verificarToken, requiereRol } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/integracionesController');

const r = Router();
const admin = staff('admin');
const superadmin = [verificarToken, requiereRol('superadmin')];

// MercadoPago del complejo (admin del tenant)
r.get('/mercadopago', admin, c.verMercadoPagoTenant);
r.put('/mercadopago', admin, c.guardarMercadoPagoTenant);
r.post('/mercadopago/probar', admin, c.probarMercadoPagoTenant);
r.delete('/mercadopago', admin, c.eliminarMercadoPagoTenant);

// MercadoPago de la plataforma (superadmin, cobro de suscripciones)
r.get('/plataforma/mercadopago', superadmin, c.verMercadoPagoPlataforma);
r.put('/plataforma/mercadopago', superadmin, c.guardarMercadoPagoPlataforma);
r.post('/plataforma/mercadopago/probar', superadmin, c.probarMercadoPagoPlataforma);

// Chatbot: el admin sólo ve el estado; la configuración es exclusiva del superadmin
r.get('/chatbot/estado', admin, c.estadoChatbotTenant);
r.get('/chatbot/:idTenant', superadmin, c.verChatbot);
r.put('/chatbot/:idTenant', superadmin, c.guardarChatbot);
r.delete('/chatbot/:idTenant', superadmin, c.eliminarChatbot);
r.post('/chatbot/:idTenant/probar', superadmin, c.probarChatbot);
r.post('/chatbot/:idTenant/baileys/conectar', superadmin, c.conectarBaileys);
r.get('/chatbot/:idTenant/baileys/estado', superadmin, c.estadoBaileys);
r.post('/chatbot/:idTenant/baileys/desconectar', superadmin, c.desconectarBaileys);

module.exports = r;
