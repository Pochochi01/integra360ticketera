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
r.post('/ventas/:id/reenviar-correo', c.reenviarCorreo);
// Links reutilizables del vendedor (sales_links con seller_id): se comparten en Instagram, Facebook o WhatsApp
r.get('/sales-links', c.salesLinks);
r.post('/sales-links', c.crearSalesLink);
r.patch('/sales-links/:id', c.actualizarSalesLink);
r.get('/sales-links/:id/tickets', c.ticketsSalesLink);

module.exports = r;
