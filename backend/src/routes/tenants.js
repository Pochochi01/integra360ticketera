const { Router } = require('express');
const { verificarToken, requiereRol } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/tenantsController');

const r = Router();
const superadmin = [verificarToken, requiereRol('superadmin')];

// Público: selector de complejos
r.get('/publico', c.listarPublico);
// Admin del tenant: su propio complejo
r.get('/mio', staff('admin'), c.miTenant);
r.put('/mio', staff('admin'), c.actualizarMiTenant);
// Superadmin: gestión de todos los complejos
r.get('/', superadmin, c.listar);
r.get('/:id', superadmin, c.detalle);
r.post('/', superadmin, c.crear);
r.put('/:id', superadmin, c.actualizar);

module.exports = r;
