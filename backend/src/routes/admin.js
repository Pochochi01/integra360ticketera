const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const { estadisticasEvento } = require('../services/estadisticasEvento');
const { actualizarEvento, detalleAdmin } = require('../services/eventosAdmin');
const { validarEvento } = require('../controllers/eventosController');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * Panel del administrador (montado en /api/admin). Sólo admin del complejo (o superadmin con X-Tenant).
 *
 * GET  /event/:id/stats   — estadísticas del evento: generales, por vendedor/canal, por tipo, por método y
 *   por día, en unidades y pesos. Sólo ventas confirmadas (pagos 'approved' de MercadoPago u otros cobros
 *   validados); sin caché, el panel lo consulta cada 10 s.
 * GET  /event/:id         — evento con sus tipos, stock total y últimos cambios auditados.
 * POST /event/:id/update  — edita datos y AGREGA entradas (ver services/eventosAdmin.js). También acepta PUT.
 */
const r = Router();
const admin = staff('admin');

r.get('/event/:id/stats', admin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await estadisticasEvento(Number(req.params.id), req.tenant.id_tenant));
}));

r.get('/event/:id', admin, asyncHandler(async (req, res) => {
  const evento = await detalleAdmin(Number(req.params.id));
  if (!evento || evento.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
  res.json(evento);
}));

const actualizar = asyncHandler(async (req, res) => {
  res.json(await actualizarEvento({ idEvento: Number(req.params.id), tenant: req.tenant, usuario: req.usuario, cambios: req.body || {}, validarEvento }));
});
r.post('/event/:id/update', admin, actualizar);
r.put('/event/:id/update', admin, actualizar);

module.exports = r;
