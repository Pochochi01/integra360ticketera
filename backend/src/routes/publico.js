const { Router } = require('express');
const c = require('../controllers/publicoController');
const { verCheckout } = require('../controllers/linksPagoController');

// Endpoints sin autenticación
const r = Router();
r.get('/links/:codigo', c.resolverLink);
// Página del complejo para el link de checkout del vendedor
r.get('/checkout/:linkId', verCheckout);
r.get('/entradas/:token', c.entradas);
r.get('/entradas/:token/verificar-pago', c.verificarPago);
r.get('/entradas/:token/tickets/:idTicket.png', c.imagenEntrada);

module.exports = r;
