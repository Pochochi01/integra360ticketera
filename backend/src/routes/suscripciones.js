const { Router } = require('express');
const { verificarToken, requiereRol } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const { seleccionarMercadoPago } = require('../middlewares/integraciones');
const c = require('../controllers/suscripcionesController');

const r = Router();
const superadmin = [verificarToken, requiereRol('superadmin')];

// Admin del complejo: ver y pagar su suscripción (se cobra con la cuenta de la plataforma)
r.get('/mia', staff('admin'), c.miSuscripcion);
r.post('/mia/pagar', staff('admin'), seleccionarMercadoPago('plataforma'), c.pagarMiSuscripcion);

// Superadmin
r.get('/planes', superadmin, c.listarPlanes);
r.post('/planes', superadmin, c.crearPlan);
r.put('/planes/:id', superadmin, c.actualizarPlan);
r.get('/tenant/:idTenant', superadmin, c.verDeTenant);
r.put('/tenant/:idTenant', superadmin, c.asignarPlan);
r.post('/tenant/:idTenant/cobrar', superadmin, seleccionarMercadoPago('plataforma'), c.cobrar);
r.post('/tenant/:idTenant/registrar-pago', superadmin, c.registrarPagoManual);
r.post('/tenant/:idTenant/cancelar', superadmin, c.cancelar);

module.exports = r;
