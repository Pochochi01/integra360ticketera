const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const Tenant = require('../models/Tenant');
const Usuario = require('../models/Usuario');
const { validarDatosUsuario } = require('./authController');
const { AppError, asyncHandler } = require('../utils/errors');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,40}[a-z0-9])$/;
const RESERVADOS = ['www', 'api', 'admin', 'app', 'default'];

/** Config editable por el tenant. Se ignoran claves desconocidas. */
const CONFIG_PERMITIDA = Tenant.CONFIG;
const limpiarConfig = (config = {}) =>
  Object.fromEntries(
    Object.entries(config || {})
      .filter(([k, v]) => CONFIG_PERMITIDA.includes(k) && (typeof v === 'string' || v === null))
      .map(([k, v]) => [k, v?.trim() ? v.trim() : null])
  );

const validarConfig = (c) => {
  if (c.color_primario && !/^#[0-9a-f]{6}$/i.test(c.color_primario)) throw new AppError(400, 'Color inválido (formato #RRGGBB)');
  if (c.mensaje_whatsapp && !c.mensaje_whatsapp.includes('{link}')) throw new AppError(400, 'El mensaje de WhatsApp debe incluir {link}');
  if (c.mensaje_whatsapp && c.mensaje_whatsapp.length > 1000) throw new AppError(400, 'El mensaje es demasiado largo');
  if (c.logo_url && !/^https?:\/\//.test(c.logo_url)) throw new AppError(400, 'URL de logo inválida');
  return c;
};

const validarTenant = (d, parcial = false) => {
  if (!parcial && !d.nombre?.trim()) throw new AppError(400, 'El nombre es obligatorio');
  if (d.slug !== undefined) {
    if (!SLUG_RE.test(d.slug)) throw new AppError(400, 'Slug inválido: minúsculas, números y guiones (3 a 42 caracteres)');
    if (RESERVADOS.includes(d.slug)) throw new AppError(400, 'Ese slug está reservado');
  }
  if (d.estado && !['activo', 'suspendido'].includes(d.estado)) throw new AppError(400, 'Estado inválido');
};

// ---------- Superadmin ----------

exports.listar = asyncHandler(async (_req, res) => res.json(await Tenant.findAll()));

exports.detalle = asyncHandler(async (req, res) => {
  const t = await Tenant.findById(req.params.id);
  if (!t) throw new AppError(404, 'Complejo no encontrado');
  res.json({ ...t, admins: await Usuario.findAll({ id_tenant: t.id_tenant, rol: 'admin' }) });
});

/** Crea el tenant y, opcionalmente, su primer administrador ({ admin: { nombre, email, password } }). */
exports.crear = asyncHandler(async (req, res) => {
  const d = { ...req.body, slug: req.body.slug?.toLowerCase() };
  if (!d.slug) throw new AppError(400, 'El slug es obligatorio');
  validarTenant(d);
  if (await Tenant.findBySlug(d.slug)) throw new AppError(409, 'Ya existe un complejo con ese slug');

  const admin = d.admin;
  if (admin) {
    validarDatosUsuario(admin);
    if (await Usuario.existeEmail(admin.email.toLowerCase())) throw new AppError(409, 'El email del administrador ya está en uso');
  }

  const id = await pool.withTransaction(async (conn) => {
    const idTenant = await Tenant.create({ ...d, config: validarConfig(limpiarConfig(d.config)) }, conn);
    if (admin) {
      const idAdmin = await Usuario.create(
        {
          nombre: admin.nombre.trim(),
          email: admin.email.toLowerCase(),
          password_hash: await bcrypt.hash(admin.password, 10),
          rol: 'admin',
        },
        conn
      );
      await Usuario.setTenantAdministrado(idAdmin, idTenant, conn);
    }
    return idTenant;
  });
  res.status(201).json(await Tenant.findById(id));
});

exports.actualizar = asyncHandler(async (req, res) => {
  const d = { ...req.body, slug: req.body.slug?.toLowerCase() };
  validarTenant(d, true);
  const actual = await Tenant.findById(req.params.id);
  if (!actual) throw new AppError(404, 'Complejo no encontrado');
  if (d.slug && d.slug !== actual.slug && (await Tenant.findBySlug(d.slug))) throw new AppError(409, 'Ya existe un complejo con ese slug');
  if (d.config) d.config = validarConfig(limpiarConfig(d.config));
  res.json(await Tenant.update(actual.id_tenant, d));
});

// ---------- Admin del tenant ----------

exports.miTenant = asyncHandler(async (req, res) => res.json(req.tenant));

/** El admin edita datos de contacto y configuración de su complejo (no el slug ni el estado). */
exports.actualizarMiTenant = asyncHandler(async (req, res) => {
  const { nombre, email_contacto, telefono, direccion, config } = req.body;
  validarTenant({ nombre }, true);
  res.json(
    await Tenant.update(req.tenant.id_tenant, {
      nombre,
      email_contacto,
      telefono,
      direccion,
      config: config ? validarConfig(limpiarConfig(config)) : undefined,
    })
  );
});

// ---------- Público ----------

exports.listarPublico = asyncHandler(async (_req, res) => res.json(await Tenant.findActivosPublico()));
