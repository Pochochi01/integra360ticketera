const { Router } = require('express');
const c = require('../controllers/publicoController');

// Endpoints sin autenticación
const r = Router();
r.get('/links/:codigo', c.resolverLink);
r.get('/entradas/:token', c.entradas);
r.get('/entradas/:token/verificar-pago', c.verificarPago);
r.get('/entradas/:token/tickets/:idTicket.png', c.imagenEntrada);

module.exports = r;
