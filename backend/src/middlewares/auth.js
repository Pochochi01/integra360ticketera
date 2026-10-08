const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');

/**
 * Roles:
 *  - superadmin: administra la plataforma (tenants). Puede operar sobre cualquier tenant enviando X-Tenant.
 *  - admin:      administrador de un tenant (complejo / boliche): eventos, vendedores, ventas, acceso.
 *  - vendedor:   punto de venta de un tenant: genera links y ve sus ventas.
 *  - comprador:  compra, transfiere y ve sus tickets (no pertenece a ningún tenant).
 *  - portero:    personal de puerta de un tenant: sólo escanea entradas en /porteria.
 */
const ROLES = ['superadmin', 'admin', 'vendedor', 'comprador', 'portero'];

const decodificar = (req) => {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
};

/** Exige un JWT válido en Authorization: Bearer <token>; deja el payload en req.usuario. */
const verificarToken = (req, _res, next) => {
  try {
    req.usuario = decodificar(req);
    if (!req.usuario) return next(new AppError(401, 'Token requerido'));
    next();
  } catch {
    next(new AppError(401, 'Token inválido o expirado'));
  }
};

/** Si viene un token válido lo decodifica; si no, continúa como anónimo. */
const tokenOpcional = (req, _res, next) => {
  try {
    req.usuario = decodificar(req) || undefined;
  } catch {
    /* anónimo */
  }
  next();
};

/** Restringe el acceso a uno o más roles. El superadmin pasa siempre. */
const requiereRol = (...roles) => (req, _res, next) => {
  if (!req.usuario) return next(new AppError(401, 'Token requerido'));
  if (req.usuario.rol !== 'superadmin' && !roles.includes(req.usuario.rol)) {
    return next(new AppError(403, 'No tiene permisos para esta acción'));
  }
  next();
};

/** Como requiereRol, pero sin excepción para el superadmin: sólo los roles indicados. */
const exigirRol = (...roles) => (req, _res, next) => {
  if (!req.usuario) return next(new AppError(401, 'Token requerido'));
  if (!roles.includes(req.usuario.rol)) return next(new AppError(403, 'Acceso exclusivo para ' + roles.join(' / ')));
  next();
};

module.exports = { ROLES, verificarToken, tokenOpcional, requiereRol, exigirRol };
