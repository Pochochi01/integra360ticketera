const { Router } = require('express');
const { verificarToken, tokenOpcional, requiereRol } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const { recibirImagen } = require('../middlewares/subidaImagen');
const c = require('../controllers/eventosController');

const r = Router();
const admin = staff('admin');

// Lista de espera y tipos (rutas fijas antes de /:id)
r.get('/lista-espera/mia', verificarToken, c.miListaEspera);
r.delete('/lista-espera/:idEspera', verificarToken, c.salirListaEspera);
r.post('/tipos/:idTipo/lista-espera', verificarToken, requiereRol('comprador'), c.unirseListaEspera);
r.get('/tipos/:idTipo/lista-espera', admin, c.listaEsperaPorTipo);
r.put('/tipos/:idTipo', admin, c.actualizarTipo);
r.delete('/tipos/:idTipo', admin, c.eliminarTipo);

// Eventos: públicos filtrados por tenant; gestión solo sobre el tenant de la sesión
r.get('/', c.listar);
r.get('/admin/todos', admin, c.listarTodos);
r.get('/:id', tokenOpcional, c.detalle);
r.post('/', admin, c.crear);
r.put('/:id', admin, c.actualizar);
r.delete('/:id', admin, c.eliminar);
r.post('/:id/cancelar', admin, c.cancelar);
r.post('/:id/tipos', admin, c.crearTipo);
r.get('/:id/asientos', c.listarAsientos);
r.post('/:id/asientos', admin, c.generarAsientos);
r.post('/:id/imagen', admin, recibirImagen('imagen'), c.subirImagen);
r.delete('/:id/imagen', admin, c.quitarImagen);

module.exports = r;
