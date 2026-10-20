const pool = require('../config/db');
const Tenant = require('../models/Tenant');
const Pago = require('../models/Pago');
const { Plan, Suscripcion } = require('../models/Suscripcion');
const { preferenciaDeSuscripcion } = require('../services/pagosService');
const { AppError, asyncHandler } = require('../utils/errors');

const validarPlan = (d, parcial = false) => {
  if (!parcial || d.nombre !== undefined) {
    if (!String(d.nombre || '').trim() || String(d.nombre).length > 80) throw new AppError(400, 'Nombre de plan inválido');
  }
  if (!parcial || d.precio_mensual !== undefined) {
    if (!(Number(d.precio_mensual) > 0)) throw new AppError(400, 'El precio mensual debe ser mayor a 0');
  }
};

// ---------- Planes (superadmin) ----------

exports.listarPlanes = asyncHandler(async (_req, res) => res.json(await Plan.findAll()));

exports.crearPlan = asyncHandler(async (req, res) => {
  validarPlan(req.body);
  try {
    const id = await Plan.create({ ...req.body, nombre: req.body.nombre.trim() });
    res.status(201).json(await Plan.findById(id));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'Ya existe un plan con ese nombre');
    throw err;
  }
});

exports.actualizarPlan = asyncHandler(async (req, res) => {
  validarPlan(req.body, true);
  if (!(await Plan.findById(req.params.id))) throw new AppError(404, 'Plan no encontrado');
  await Plan.update(req.params.id, req.body);
  res.json(await Plan.findById(req.params.id));
});

// ---------- Suscripción de cada tenant ----------

const conPagos = async (s) => (s ? { ...s, pagos: await Pago.findBySuscripcion(s.id_suscripcion) } : null);

exports.verDeTenant = asyncHandler(async (req, res) => {
  if (!(await Tenant.findById(req.params.idTenant))) throw new AppError(404, 'Complejo no encontrado');
  res.json(await conPagos(await Suscripcion.findByTenant(req.params.idTenant)));
});

/** PUT /suscripciones/tenant/:idTenant { id_plan } — asigna o cambia el plan. */
exports.asignarPlan = asyncHandler(async (req, res) => {
  if (!(await Tenant.findById(req.params.idTenant))) throw new AppError(404, 'Complejo no encontrado');
  const plan = await Plan.findById(req.body.id_plan);
  if (!plan || !plan.activo) throw new AppError(400, 'Plan inexistente o inactivo');
  res.json(await conPagos(await Suscripcion.asignarPlan(req.params.idTenant, plan.id_plan)));
});

/** Genera un link de cobro de un mes con la cuenta MercadoPago de la plataforma (OAuth, ámbito 0). */
const generarCobro = async (req, idTenant) => {
  const s = await Suscripcion.findByTenant(idTenant);
  if (!s) throw new AppError(409, 'El complejo no tiene un plan asignado');
  if (s.estado === 'cancelada') throw new AppError(409, 'La suscripción está cancelada');
  const pref = await preferenciaDeSuscripcion(s);
  // Credenciales de prueba (live_mode = false) → checkout sandbox
  return { url: !req.mercadopago.live_mode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point, id_pago: pref.id_pago };
};

exports.cobrar = asyncHandler(async (req, res) => res.json(await generarCobro(req, Number(req.params.idTenant))));

/** POST /suscripciones/tenant/:idTenant/registrar-pago — cobro manual (efectivo / transferencia). */
exports.registrarPagoManual = asyncHandler(async (req, res) => {
  const s = await Suscripcion.findByTenant(req.params.idTenant);
  if (!s) throw new AppError(409, 'El complejo no tiene un plan asignado');
  await pool.withTransaction(async (conn) => {
    await Suscripcion.lockById(s.id_suscripcion, conn);
    await Pago.create(
      { id_suscripcion: s.id_suscripcion, proveedor: 'transferencia', estado: 'aprobado', monto: s.precio_mensual, detalle: req.body.detalle?.slice(0, 255) || 'Registrado por el superadmin' },
      conn
    );
    await Suscripcion.extenderUnMes(s.id_suscripcion, conn);
  });
  res.json(await conPagos(await Suscripcion.findByTenant(req.params.idTenant)));
});

exports.cancelar = asyncHandler(async (req, res) => {
  const s = await Suscripcion.findByTenant(req.params.idTenant);
  if (!s) throw new AppError(404, 'Sin suscripción');
  await Suscripcion.setEstado(s.id_suscripcion, 'cancelada');
  res.json(await conPagos(await Suscripcion.findByTenant(req.params.idTenant)));
});

// ---------- Admin del complejo ----------

exports.miSuscripcion = asyncHandler(async (req, res) => res.json(await conPagos(await Suscripcion.findByTenant(req.tenant.id_tenant))));

exports.pagarMiSuscripcion = asyncHandler(async (req, res) => res.json(await generarCobro(req, req.tenant.id_tenant)));
