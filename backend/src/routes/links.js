const { Router } = require('express');
const { soloVendedor } = require('../middlewares/tenant');
const { validarCompra } = require('../middlewares/validarCompra');
const c = require('../controllers/linksPagoController');

/**
 * Links de pago de vendedores (montado en /api/links).
 * Cadena: vendedor activo de su complejo → tenant_id / seller_id de la sesión → comprador →
 *         validación de la compra (stock, límites, medio habilitado) → reserva + link.
 */
const r = Router();
r.use(soloVendedor);
r.post('/generar', c.verificarAlcance, c.resolverComprador, validarCompra('vendedor'), c.generar);
r.get('/', c.listar);

module.exports = r;
