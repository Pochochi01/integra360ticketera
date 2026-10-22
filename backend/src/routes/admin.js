const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const { estadisticasEvento } = require('../services/estadisticasEvento');
const { asyncHandler } = require('../utils/errors');

/**
 * Panel del administrador (montado en /api/admin). Sólo admin del complejo (o superadmin con X-Tenant).
 *
 * GET /event/:id/stats — estadísticas del evento: generales, por vendedor/canal, por tipo, por método y
 *   por día, en unidades y pesos. Sólo ventas confirmadas (pagos 'approved' de MercadoPago u otros cobros
 *   validados); sin caché, el panel lo consulta cada 10 s.
 */
const r = Router();
r.get('/event/:id/stats', staff('admin'), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await estadisticasEvento(Number(req.params.id), req.tenant.id_tenant));
}));

module.exports = r;
