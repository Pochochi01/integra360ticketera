const { Router } = require('express');
const { verificarToken, requiereRol } = require('../middlewares/auth');
const c = require('../controllers/usuariosController');

// Gestión global de usuarios (superadmin)
const r = Router();
r.use(verificarToken, requiereRol('superadmin'));
r.get('/', c.listar);
r.get('/:id', c.detalle);
r.post('/', c.crear);
r.put('/:id', c.actualizar);
r.delete('/:id', c.eliminar);

module.exports = r;
