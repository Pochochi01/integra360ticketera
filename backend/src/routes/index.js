const { Router } = require('express');
const { resolverTenant } = require('../middlewares/tenant');

const router = Router();

// Identifica el tenant público (subdominio o X-Tenant) en todas las peticiones
router.use(resolverTenant);

router.use('/auth', require('./auth'));
router.use('/tenants', require('./tenants'));
router.use('/usuarios', require('./usuarios'));
router.use('/eventos', require('./eventos'));
router.use('/ventas', require('./ventas'));
router.use('/tickets', require('./tickets'));
router.use('/vendedores', require('./vendedores'));
router.use('/vendedor', require('./vendedor'));
router.use('/porteros', require('./porteros'));
router.use('/publico', require('./publico'));
router.use('/acceso', require('./acceso'));
// /api/porteria y su alias con tilde (/api/portería llega codificado como /api/porter%C3%ADa)
router.use(['/porteria', encodeURI('/portería')], require('./porteria'));
router.use('/pagos', require('./pagos'));
router.use('/integraciones', require('./integraciones'));
router.use('/suscripciones', require('./suscripciones'));

module.exports = router;
