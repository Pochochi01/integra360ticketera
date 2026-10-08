const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const Tenant = require('../models/Tenant');
const { ROLES } = require('../middlewares/auth');
const { validarDatosUsuario } = require('./authController');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * Gestión global de usuarios (solo superadmin).
 * Los vendedores se gestionan desde /vendedores (panel del tenant) porque tienen ficha propia.
 */

const validarRolTenant = async (rol, idTenant) => {
  if (rol && !ROLES.includes(rol)) throw new AppError(400, 'Rol inválido');
  if (rol === 'vendedor') throw new AppError(400, 'Los vendedores se crean desde el panel de vendedores del complejo');
  if (rol === 'admin') {
    if (!idTenant || !(await Tenant.findById(idTenant))) throw new AppError(400, 'Un administrador debe pertenecer a un complejo');
  }
};

exports.listar = asyncHandler(async (req, res) => res.json(await Usuario.findAll(req.query)));

exports.detalle = asyncHandler(async (req, res) => {
  const u = await Usuario.findById(req.params.id);
  if (!u) throw new AppError(404, 'Usuario no encontrado');
  res.json(u);
});

exports.crear = asyncHandler(async (req, res) => {
  const whatsapp = validarDatosUsuario(req.body);
  const rol = req.body.rol || 'comprador';
  await validarRolTenant(rol, req.body.id_tenant);
  const email = req.body.email.toLowerCase();
  if (await Usuario.existeEmail(email)) throw new AppError(409, 'Ya existe un usuario con ese email');
  const id = await Usuario.create({
    nombre: req.body.nombre.trim(),
    apellido: req.body.apellido?.trim() || null,
    email,
    dni: req.body.dni,
    whatsapp,
    rol,
    password_hash: await bcrypt.hash(req.body.password, 10),
  });
  if (rol === 'admin') await Usuario.setTenantAdministrado(id, Number(req.body.id_tenant));
  res.status(201).json(await Usuario.findById(id));
});

exports.actualizar = asyncHandler(async (req, res) => {
  const actual = await Usuario.findById(req.params.id);
  if (!actual) throw new AppError(404, 'Usuario no encontrado');
  if (actual.rol === 'vendedor' || req.body.rol === 'vendedor') throw new AppError(400, 'Los vendedores se gestionan desde el panel del complejo');
  const rol = req.body.rol || actual.rol;
  const idTenant = req.body.id_tenant !== undefined ? req.body.id_tenant : actual.id_tenant;
  await validarRolTenant(rol, idTenant);
  if (Number(req.params.id) === req.usuario.id_usuario && rol !== 'superadmin') {
    throw new AppError(409, 'No puede quitarse a sí mismo el rol de superadmin');
  }
  const email = req.body.email?.toLowerCase();
  if (email && (await Usuario.existeEmail(email, actual.id_usuario))) throw new AppError(409, 'Email en uso');
  await Usuario.update(req.params.id, { nombre: req.body.nombre, apellido: req.body.apellido, email, rol });
  await Usuario.setTenantAdministrado(req.params.id, rol === 'admin' ? Number(idTenant) : null);
  res.json(await Usuario.findById(req.params.id));
});

exports.eliminar = asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id_usuario) throw new AppError(409, 'No puede eliminarse a sí mismo');
  try {
    const [r] = await Usuario.remove(req.params.id);
    if (!r.affectedRows) throw new AppError(404, 'Usuario no encontrado');
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') throw new AppError(409, 'El usuario tiene ventas, tickets o ficha de vendedor asociados');
    throw err;
  }
  res.status(204).end();
});
