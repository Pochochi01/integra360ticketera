const { Router } = require('express');
const { verificarToken } = require('../middlewares/auth');
const c = require('../controllers/authController');

const r = Router();
r.post('/register', c.register);
r.post('/login', c.login);
r.get('/me', verificarToken, c.me);
r.put('/me', verificarToken, c.actualizarPerfil);
r.get('/validar-whatsapp', c.validarWhatsapp);

module.exports = r;
