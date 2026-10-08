const { Router } = require('express');
const { verificarToken } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/ticketsController');

const r = Router();
r.get('/mios', verificarToken, c.misTickets);
r.get('/transferencias', verificarToken, c.misTransferencias);
r.get('/', staff('admin'), c.listar);
r.get('/:id', verificarToken, c.detalle);
r.get('/:id/imagen', verificarToken, c.imagen);
r.post('/:id/transferir', verificarToken, c.transferir);

module.exports = r;
