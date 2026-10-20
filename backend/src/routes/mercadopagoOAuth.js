const { Router } = require('express');
const { verificarToken, exigirRol } = require('../middlewares/auth');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/mercadopagoOAuthController');

/**
 * OAuth de MercadoPago (montado en /api/auth/mercadopago).
 * La URL de callback debe coincidir EXACTAMENTE con la "URL de redireccionamiento" registrada en la
 * aplicación de MercadoPago Developers (MP_REDIRECT_URI).
 */
const r = Router();
r.get('/connect', staff('admin'), c.conectarTenant); // cuenta del complejo (cobra entradas)
r.get('/connect/plataforma', verificarToken, exigirRol('superadmin'), c.conectarPlataforma); // cuenta de la plataforma (suscripciones)
r.get('/callback', c.callback);

module.exports = r;
