const { Router } = require('express');
const c = require('../controllers/publicoController');
const { verCheckout } = require('../controllers/linksPagoController');

// Endpoints sin autenticación
const r = Router();
r.get('/links/:codigo', c.resolverLink);
// Página del complejo para el link de checkout del vendedor
r.get('/checkout/:linkId', verCheckout);
// Página del link de venta del admin
r.get('/venta/:linkId', require('../controllers/salesLinksController').verPublico);
// Link único de descarga de cada ticket (el que llega por correo)
r.get('/tickets/:token/descargar', c.descargarTicket);
r.get('/entradas/:token', c.entradas);
r.get('/entradas/:token/verificar-pago', c.verificarPago);
r.get('/entradas/:token/tickets/:idTicket.png', c.imagenEntrada);

module.exports = r;
