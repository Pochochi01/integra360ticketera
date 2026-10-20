const Tenant = require('../models/Tenant');
const Vendedor = require('../models/Vendedor');
const Portero = require('../models/Portero');
const { verificarToken, requiereRol, exigirRol } = require('./auth');
const { AppError } = require('../utils/errors');

const lista = (valor) => valor.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const DOMINIOS_BASE = lista(process.env.TENANT_BASE_DOMAINS || 'localhost');
// Subdominios de la propia plataforma: nunca son un complejo (ej. api.midominio.com es el backend)
const RESERVADOS = new Set(lista(process.env.TENANT_SUBDOMINIOS_RESERVADOS || 'www,api,app,admin'));

/**
 * Extrae el slug del tenant del subdominio: "norte.integra360.com" → "norte",
 * "norte.localhost" → "norte". Ignora los subdominios reservados (www, api…) y los hosts sin subdominio.
 */
const slugDesdeHost = (host = '') => {
  const nombre = host.split(':')[0].toLowerCase();
  for (const base of DOMINIOS_BASE) {
    if (nombre.endsWith(`.${base}`)) {
      const sub = nombre.slice(0, -(base.length + 1)).split('.').pop();
      return sub && !RESERVADOS.has(sub) ? sub : null;
    }
  }
  return null;
};

/**
 * Identificación pública del tenant (para compradores y visitantes).
 * Orden: subdominio → header X-Tenant (slug). Si no se indica ninguno, req.tenantPublico queda en null
 * y la API muestra todos los tenants (vista marketplace).
 */
const resolverTenant = async (req, _res, next) => {
  try {
    const slug = slugDesdeHost(req.headers['x-forwarded-host'] || req.headers.host) || req.headers['x-tenant'];
    req.tenantPublico = null;
    if (slug) {
      const tenant = await Tenant.findBySlug(String(slug).toLowerCase());
      if (!tenant || tenant.estado !== 'activo') throw new AppError(404, 'Complejo no encontrado');
      req.tenantPublico = tenant;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Tenant de la sesión para el personal (admin / vendedor / portero): sale del JWT, nunca del cliente.
 * El superadmin elige sobre qué tenant opera con el header X-Tenant (o el subdominio).
 */
const tenantDeSesion = async (req, _res, next) => {
  try {
    let tenant;
    if (req.usuario.rol === 'superadmin') {
      tenant = req.tenantPublico;
      if (!tenant) throw new AppError(400, 'Seleccione un complejo (header X-Tenant) para operar como superadmin');
    } else {
      if (!req.usuario.id_tenant) throw new AppError(403, 'El usuario no pertenece a ningún complejo');
      tenant = await Tenant.findById(req.usuario.id_tenant);
      if (!tenant) throw new AppError(403, 'Complejo inexistente');
      if (tenant.estado !== 'activo') throw new AppError(403, 'El complejo está suspendido');
    }
    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
};

/** Para rutas del vendedor: carga su ficha y exige que esté activo. */
const vendedorActivo = async (req, _res, next) => {
  try {
    const vendedor = await Vendedor.findByUsuario(req.usuario.id_usuario);
    if (!vendedor || vendedor.id_tenant !== req.tenant.id_tenant) throw new AppError(403, 'No es vendedor de este complejo');
    if (vendedor.estado !== 'activo') throw new AppError(403, 'Su usuario de vendedor está inactivo');
    req.vendedor = vendedor;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Para la Portería: carga la ficha del portero y exige que esté activo.
 * Se consulta en cada petición: desactivar a un portero lo deja afuera al instante, aunque su JWT siga vigente.
 */
const porteroActivo = async (req, _res, next) => {
  try {
    const portero = await Portero.findByUsuario(req.usuario.id_usuario);
    if (!portero || portero.id_tenant !== req.tenant.id_tenant) throw new AppError(403, 'No es portero de este complejo');
    if (portero.estado !== 'activo') throw new AppError(403, 'Su usuario de portero está desactivado');
    req.portero = portero;
    next();
  } catch (err) {
    next(err);
  }
};

/** Cadenas listas para usar en las rutas. */
const staff = (...roles) => [verificarToken, requiereRol(...roles), tenantDeSesion];
const soloVendedor = [verificarToken, requiereRol('vendedor'), tenantDeSesion, vendedorActivo];
// Sólo porteros: sin la excepción habitual del superadmin (nadie más valida en la puerta)
const soloPortero = [verificarToken, exigirRol('portero'), tenantDeSesion, porteroActivo];

/** Lanza 404 si el recurso no pertenece al tenant de la sesión (no revela que existe en otro tenant). */
const asegurarTenant = (recurso, req, mensaje = 'Recurso no encontrado') => {
  if (!recurso || recurso.id_tenant !== req.tenant.id_tenant) throw new AppError(404, mensaje);
  return recurso;
};

module.exports = { resolverTenant, tenantDeSesion, vendedorActivo, porteroActivo, staff, soloVendedor, soloPortero, asegurarTenant, slugDesdeHost };
