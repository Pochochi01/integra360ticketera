const { Router } = require('express');
const { staff } = require('../middlewares/tenant');
const { estadisticasEvento } = require('../services/estadisticasEvento');
const { ingresosEvento } = require('../services/ingresosEvento');
const puerta = require('../services/ventaPuerta');
const { validarCompra } = require('../middlewares/validarCompra');
const { resolverComprador } = require('../controllers/linksPagoController');
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

/** GET /event/:id/ingresos — control de ingresos por tipo de entrada (dashboard de Porteros, se consulta cada 10 s). */
r.get('/event/:id/ingresos', admin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await ingresosEvento(Number(req.params.id), req.tenant.id_tenant));
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

/**
 * GET /ventas/links/:ventaId — links de descarga de una venta PAGADA del complejo, uno por ticket (cada uno con
 * su QR único). Lo usa el botón «Enviar por WhatsApp» de /admin/ventas para armar el mensaje al comprador.
 *   → { ventaId, buyer_name, buyer_email, buyer_phone, evento, estado_correo, tickets: [{ ticketId, numero, tipo, link }] }
 * buyer_phone viene en E.164 (o null si no hay teléfono). 409 si la venta no está pagada; 404 si es de otro complejo.
 */
r.get('/ventas/links/:ventaId', admin, asyncHandler(async (req, res) => {
  const [[venta]] = await pool.query(
    `SELECT v.id_venta, v.estado, v.whatsapp_contacto AS whatsapp, e.id_tenant, e.nombre AS evento,
            CONCAT_WS(' ', u.nombre, u.apellido) AS comprador, u.email, u.whatsapp AS whatsapp_cuenta
       FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento JOIN usuarios u ON u.id_usuario = v.id_usuario
      WHERE v.id_venta = ?`, [Number(req.params.ventaId)]);
  if (!venta || venta.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Venta no encontrada');
  if (venta.estado !== 'pagado') throw new AppError(409, 'Sólo se envían las entradas de ventas pagadas');
  const [conLinks] = await correosDeVentas([venta]);
  res.json({
    ventaId: venta.id_venta,
    buyer_name: venta.comprador,
    buyer_email: venta.email,
    // El de la compra; si no se cargó, el de la cuenta del comprador
    buyer_phone: venta.whatsapp || venta.whatsapp_cuenta || null,
    evento: venta.evento,
    estado_correo: conLinks.estado_correo,
    tickets: conLinks.tickets_links.map((t) => ({ ticketId: t.id_ticket, numero: t.numero, tipo: t.tipo, link: t.url })),
  });
}));

r.post('/ventas/:id/reenviar-correo', admin, asyncHandler(async (req, res) => {
  const [[v]] = await pool.query('SELECT e.id_tenant FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento WHERE v.id_venta = ?', [Number(req.params.id)]);
  if (!v || v.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Venta no encontrada');
  res.json(await enviarEntradasPorCorreo(Number(req.params.id)));
}));
r.put('/event/:id/update', admin, actualizar);

// ---------- Venta en portería (ver services/ventaPuerta.js) ----------

/** GET /event/:id/qr-compra — URLs de compra (general y por tipo) para generar los QR de la puerta. */
r.get('/event/:id/qr-compra', admin, asyncHandler(async (req, res) => res.json(await puerta.qrsDeCompra(req.params.id, req.tenant.id_tenant))));

/**
 * POST /puerta/cobro — boletería: { id_evento, id_tipo, cantidad, comprador?: { nombre, telefono, email? } }
 * → 201 { id_venta, init_point, qr_pago (data URL), monto_total, expira_en }. No descuenta stock: lo hace el webhook.
 */
r.post('/puerta/cobro', admin,
  (req, _res, next) => {
    const cantidad = Number(req.body.cantidad || 1);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) return next(new AppError(400, 'La cantidad debe ser un entero entre 1 y 50'));
    if (!req.body.id_evento || !req.body.id_tipo) return next(new AppError(400, 'Elegí el evento y el tipo de entrada'));
    req.body.items = [{ id_tipo: Number(req.body.id_tipo), cantidad }];
    req.body.metodo_pago = 'mercadopago';
    next();
  },
  // Con nombre y teléfono se identifica al comprador como siempre; sin datos, comprador anónimo de la puerta
  asyncHandler(async (req, res, next) => {
    const c = req.body.comprador || {};
    if (c.nombre?.trim() && (c.telefono || c.whatsapp)) return resolverComprador(req, res, next);
    req.body.comprador = null;
    req.body.id_usuario_destino = await puerta.compradorAnonimo();
    next();
  }),
  validarCompra('puerta'),
  asyncHandler(async (req, res) => res.status(201).json(await puerta.crearCobroAsistido(req))));

/** GET /puerta/cobro/:id — estado del cobro (la pantalla de boletería lo consulta cada 2 s). */
r.get('/puerta/cobro/:id', admin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await puerta.estadoCobro(req.params.id, req.tenant.id_tenant));
}));

module.exports = r;
