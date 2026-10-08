const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/porterosController');

// CRUD de porteros (admin del complejo; el superadmin opera sobre el complejo elegido)
const r = Router();
r.use(staff('admin'));
r.get('/', c.listar);
r.post('/', c.crear);
r.put('/:id', c.actualizar);
r.post('/:id/password', c.regenerarPassword);
r.delete('/:id', c.eliminar);

module.exports = r;
