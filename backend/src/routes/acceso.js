const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const c = require('../controllers/accesoController');

// Supervisión del control de acceso (admin del tenant). Validar entradas es exclusivo de los porteros: /api/porteria
const r = Router();
r.get('/historial', staff('admin'), c.historial);

module.exports = r;
