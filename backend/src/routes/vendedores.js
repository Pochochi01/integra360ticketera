const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/vendedoresController');

// CRUD de vendedores / puntos de venta (admin del tenant)
const r = Router();
r.use(staff('admin'));
r.get('/', c.listar);
r.get('/:id', c.detalle);
r.post('/', c.crear);
r.put('/:id', c.actualizar);
r.delete('/:id', c.eliminar);
r.get('/:id/ventas', c.ventas);

module.exports = r;
