const { Router } = require('express');
const { soloPortero } = require('../middlewares/tenant');
const c = require('../controllers/accesoController');

/**
 * Portería: exclusiva del rol "portero" (JWT válido + rol portero + portero activo de su complejo).
 * Ningún otro rol, ni el superadmin, valida entradas.
 */
const r = Router();
r.use(soloPortero);
r.post('/validarQR', c.validarQR);
r.post('/validar', c.validarQR); // alias
r.get('/eventos', c.eventosPorteria);
r.get('/historial', c.historial);

module.exports = r;
