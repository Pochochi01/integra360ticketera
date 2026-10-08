const { Router } = require('express');
const { verificarToken, requiereRol } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const { validarCompra } = require('../middlewares/validarCompra');
const { seleccionarMercadoPago } = require('../middlewares/integraciones');
const c = require('../controllers/ventasController');

const r = Router();
const admin = staff('admin');

// Compra del comprador (opcionalmente desde un link de vendedor: body.codigo_link)
r.post('/', verificarToken, requiereRol('comprador'), validarCompra('normal'), c.crear);
// Emisión administrativa del tenant
r.post('/corporativa', admin, c.resolverDestinatario, validarCompra('corporativa'), c.crearCorporativa);
r.post('/invitaciones', admin, c.resolverDestinatario, validarCompra('invitacion'), c.crearInvitacion);

r.get('/mias', verificarToken, c.misVentas);
r.get('/', admin, c.listar);
r.get('/:id', verificarToken, c.detalle);
// Las credenciales de MercadoPago se eligen según el complejo dueño de la venta
r.post('/:id/pagar', verificarToken, requiereRol('comprador'), seleccionarMercadoPago('venta', { soloSiLaVentaUsaMercadoPago: true }), c.pagar);
r.get('/:id/verificar-pago', verificarToken, c.verificarPago);
r.post('/:id/confirmar-pago', admin, c.confirmarPago);
r.post('/:id/cancelar', verificarToken, c.cancelar);
r.post('/:id/reenviar-whatsapp', verificarToken, c.reenviarWhatsapp);

module.exports = r;
