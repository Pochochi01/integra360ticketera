const { Router } = require('express');
const { soloVendedor } = require('../middlewares/tenant');
const { requiereChatbot } = require('../middlewares/integraciones');
const c = require('../controllers/vendedorPanelController');

// Panel del vendedor autenticado
const r = Router();
r.use(soloVendedor);
r.get('/perfil', c.perfil);
r.get('/eventos', c.eventos);
r.get('/links', c.links);
r.post('/links', c.crearLink);
r.patch('/links/:id', c.actualizarLink);
r.post('/links/:id/enviar', requiereChatbot, c.enviarLink);
r.get('/ventas', c.ventas);

module.exports = r;
