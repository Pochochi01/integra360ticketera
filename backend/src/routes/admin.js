const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const { estadisticasEvento } = require('../services/estadisticasEvento');
const { actualizarEvento, detalleAdmin } = require('../services/eventosAdmin');
const { correosDeVentas, enviarEntradasPorCorreo } = require('../services/correo');
const pool = require('../config/db');
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
 * GET  /event/:id/correos — ventas pagadas del evento con el estado del correo y el link de cada ticket
 * POST /ventas/:id/reenviar-correo — reenvía el correo con las entradas (cualquier venta pagada del complejo)
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

r.get('/event/:id/correos', admin, asyncHandler(async (req, res) => {
  const [ventas] = await pool.query(
    `SELECT v.id_venta, v.estado, v.monto_total, v.fecha_venta, v.whatsapp_contacto AS whatsapp, v.metodo_pago,
            CONCAT_WS(' ', u.nombre, u.apellido) AS comprador, u.email, CONCAT_WS(' ', uv.nombre, uv.apellido) AS vendedor
       FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento JOIN usuarios u ON u.id_usuario = v.id_usuario
       LEFT JOIN vendedores vd ON vd.id_vendedor = v.id_vendedor LEFT JOIN usuarios uv ON uv.id_usuario = vd.id_usuario
      WHERE v.id_evento = ? AND e.id_tenant = ? AND v.estado = 'pagado'
      ORDER BY v.fecha_venta DESC, v.id_venta DESC`, [Number(req.params.id), req.tenant.id_tenant]);
  res.json(await correosDeVentas(ventas));
}));

r.post('/ventas/:id/reenviar-correo', admin, asyncHandler(async (req, res) => {
  const [[v]] = await pool.query('SELECT e.id_tenant FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento WHERE v.id_venta = ?', [Number(req.params.id)]);
  if (!v || v.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Venta no encontrada');
  res.json(await enviarEntradasPorCorreo(Number(req.params.id)));
}));
r.put('/event/:id/update', admin, actualizar);

module.exports = r;
