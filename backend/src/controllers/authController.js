const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const Vendedor = require('../models/Vendedor');
const Portero = require('../models/Portero');
const Tenant = require('../models/Tenant');
const { normalizarWhatsapp } = require('../utils/whatsapp');
const { AppError, asyncHandler } = require('../utils/errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAIS = () => process.env.WHATSAPP_PAIS_DEFECTO || 'AR';

/** El JWT lleva rol y tenant: el backend nunca confía en un tenant enviado por el cliente para el personal. */
const firmarToken = (u, extra = {}) =>
  jwt.sign(
    { id_usuario: u.id_usuario, email: u.email, nombre: u.nombre, rol: u.rol, id_tenant: u.id_tenant || null, ...extra },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

/** Valida y normaliza los datos comunes de un usuario. Devuelve el WhatsApp en E.164 (o null si no se envió). */
const validarDatosUsuario = ({ nombre, email, dni, password, whatsapp }, { requierePassword = true, requiereWhatsapp = false } = {}) => {
  if (!nombre?.trim() || !email) throw new AppError(400, 'Nombre y email son obligatorios');
  if (!EMAIL_RE.test(email)) throw new AppError(400, 'Email inválido');
  if (dni && !/^\d{6,12}$/.test(String(dni))) throw new AppError(400, 'DNI inválido (6 a 12 dígitos)');
  if (requierePassword && (!password || password.length < 6)) throw new AppError(400, 'La contraseña debe tener al menos 6 caracteres');
  if (requiereWhatsapp && !whatsapp) throw new AppError(400, 'El número de WhatsApp es obligatorio');
  if (!whatsapp) return null;
  const normalizado = normalizarWhatsapp(whatsapp, PAIS());
  if (!normalizado) throw new AppError(400, 'Número de WhatsApp inválido (debe ser un celular, ej. +54 9 11 2345 6789)');
  return normalizado;
};

exports.validarDatosUsuario = validarDatosUsuario;
exports.firmarToken = firmarToken;

/** Registro público: siempre crea compradores (sin tenant). */
exports.register = asyncHandler(async (req, res) => {
  const whatsapp = validarDatosUsuario(req.body, { requiereWhatsapp: true });
  const email = req.body.email.toLowerCase();
  if (await Usuario.existeEmail(email)) throw new AppError(409, 'Ya existe un usuario con ese email');
  if (await Usuario.existeDniComprador(req.body.dni)) throw new AppError(409, 'Ya existe un comprador con ese DNI');
  const id = await Usuario.create({
    nombre: req.body.nombre.trim(),
    apellido: req.body.apellido?.trim() || null,
    email,
    dni: req.body.dni ? String(req.body.dni) : null,
    whatsapp,
    password_hash: await bcrypt.hash(req.body.password, 10),
    rol: 'comprador',
  });
  const usuario = await Usuario.findById(id);
  res.status(201).json({ token: firmarToken(usuario), usuario });
});

exports.login = asyncHandler(async (req, res) => {
  // "email" acepta también el nombre de usuario de un portero (ej. norte.juan)
  const login = req.body.email ?? req.body.usuario;
  const { password } = req.body;
  if (!login || !password) throw new AppError(400, 'Usuario y contraseña son obligatorios');
  const u = await Usuario.findByLoginConPassword(login);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new AppError(401, 'Credenciales inválidas');

  // El complejo del personal sale de las tablas de pertenencia (administradores / vendedores)
  const usuario = await Usuario.findById(u.id_usuario);
  const extra = {};
  if (['admin', 'vendedor', 'portero'].includes(usuario.rol)) {
    if (!usuario.id_tenant) throw new AppError(403, 'El usuario no está asignado a ningún complejo');
    const tenant = await Tenant.findById(usuario.id_tenant);
    if (tenant?.estado !== 'activo') throw new AppError(403, 'El complejo está suspendido');
  }
  if (usuario.rol === 'vendedor') {
    const vendedor = await Vendedor.findByUsuario(u.id_usuario);
    if (!vendedor || vendedor.estado !== 'activo') throw new AppError(403, 'Su usuario de vendedor está inactivo');
    extra.id_vendedor = vendedor.id_vendedor;
  }
  if (usuario.rol === 'portero') {
    const portero = await Portero.findByUsuario(u.id_usuario);
    if (!portero || portero.estado !== 'activo') throw new AppError(403, 'Su usuario de portero está desactivado');
    extra.id_portero = portero.id_portero;
  }
  res.json({ token: firmarToken(usuario, extra), usuario });
});

exports.me = asyncHandler(async (req, res) => {
  const usuario = await Usuario.findById(req.usuario.id_usuario);
  if (!usuario) throw new AppError(404, 'Usuario no encontrado');
  res.json(usuario);
});

/** PUT /auth/me — el usuario actualiza nombre, WhatsApp o contraseña. */
exports.actualizarPerfil = asyncHandler(async (req, res) => {
  const cambios = {};
  if (req.body.nombre?.trim()) cambios.nombre = req.body.nombre.trim();
  if (req.body.apellido !== undefined) cambios.apellido = req.body.apellido?.trim() || null;
  if (req.body.whatsapp !== undefined) {
    cambios.whatsapp = normalizarWhatsapp(req.body.whatsapp, PAIS());
    if (!cambios.whatsapp) throw new AppError(400, 'Número de WhatsApp inválido');
  }
  if (req.body.password) {
    if (req.body.password.length < 6) throw new AppError(400, 'La contraseña debe tener al menos 6 caracteres');
    cambios.password_hash = await bcrypt.hash(req.body.password, 10);
  }
  res.json(await Usuario.update(req.usuario.id_usuario, cambios));
});

/** Utilidad pública: valida un WhatsApp y devuelve su forma normalizada (para validar formularios en vivo). */
exports.validarWhatsapp = asyncHandler(async (req, res) => {
  const normalizado = normalizarWhatsapp(req.query.numero, PAIS());
  res.json({ valido: !!normalizado, normalizado });
});
