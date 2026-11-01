const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const Portero = require('../models/Portero');
const Usuario = require('../models/Usuario');
const { asegurarTenant } = require('../middlewares/tenant');
const { generarPassword, generarUsuario } = require('../utils/credenciales');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * CRUD de porteros para el administrador del complejo.
 * El sistema genera usuario y contraseña: la contraseña se devuelve UNA sola vez (al crear o al
 * regenerarla) y en la base sólo queda su hash bcrypt.
 */

const texto = (v, campo, { obligatorio = true } = {}) => {
  const s = String(v ?? '').trim();
  if (obligatorio && !s) throw new AppError(400, `El ${campo} es obligatorio`);
  if (s.length > 80) throw new AppError(400, `El ${campo} es demasiado largo`);
  return s || null;
};

const porteroDelTenant = async (id, req) => asegurarTenant(await Portero.findById(id), req, 'Portero no encontrado');

exports.listar = asyncHandler(async (req, res) => res.json(await Portero.findByTenant(req.tenant.id_tenant)));

/** Funciones del personal de puerta: escanear en la Portería o cobrar en la boletería. */
const ROLES_PUERTA = ['portero', 'cobrador'];
const rolPuerta = (rol) => {
  if (rol === undefined) return 'portero';
  if (!ROLES_PUERTA.includes(rol)) throw new AppError(400, 'Función inválida (portero | cobrador)');
  return rol;
};

/** POST /porteros { nombre, apellido?, rol?: 'portero' | 'cobrador' } → { portero, credenciales: { usuario, password } } */
exports.crear = asyncHandler(async (req, res) => {
  const nombre = texto(req.body.nombre, 'nombre');
  const apellido = texto(req.body.apellido, 'apellido', { obligatorio: false });
  const rol = rolPuerta(req.body.rol);
  const password = generarPassword();
  const hash = await bcrypt.hash(password, 10);

  // Reintenta si otro admin tomó el mismo usuario en paralelo (lo detecta la UNIQUE KEY)
  for (let intento = 0; intento < 3; intento++) {
    try {
      const id = await pool.withTransaction(async (conn) => {
        const base = generarUsuario(req.tenant.slug, nombre, apellido);
        const usuario = generarUsuario(req.tenant.slug, nombre, apellido, await Portero.usuariosConPrefijo(base, conn));
        const idUsuario = await Usuario.create({ nombre, apellido, email: null, password_hash: hash, rol }, conn);
        return Portero.create({ id_tenant: req.tenant.id_tenant, id_usuario: idUsuario, usuario }, conn);
      });
      const portero = await Portero.findById(id);
      return res.status(201).json({ portero, credenciales: { usuario: portero.usuario, password } });
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' || intento === 2) throw err;
    }
  }
});

/** PUT /porteros/:id { nombre?, apellido?, estado? } */
exports.actualizar = asyncHandler(async (req, res) => {
  const p = await porteroDelTenant(req.params.id, req);
  const cambios = {};
  if (req.body.nombre !== undefined) cambios.nombre = texto(req.body.nombre, 'nombre');
  if (req.body.apellido !== undefined) cambios.apellido = texto(req.body.apellido, 'apellido', { obligatorio: false });
  if (req.body.estado !== undefined && !['activo', 'inactivo'].includes(req.body.estado)) throw new AppError(400, 'Estado inválido');
  const rol = req.body.rol !== undefined ? rolPuerta(req.body.rol) : null;

  await pool.withTransaction(async (conn) => {
    if (Object.keys(cambios).length) await Usuario.update(p.id_usuario, cambios, conn);
    if (req.body.estado) await Portero.setEstado(p.id_portero, req.body.estado, conn);
    // Cambio de función (portero ↔ cobrador): rige desde su próximo pedido (el rol se verifica en cada uno)
    if (rol) await conn.query('UPDATE usuarios SET rol = ? WHERE id_usuario = ?', [rol, p.id_usuario]);
  });
  res.json(await Portero.findById(p.id_portero));
});

/** POST /porteros/:id/password → { usuario, password } nueva (la anterior deja de funcionar). */
exports.regenerarPassword = asyncHandler(async (req, res) => {
  const p = await porteroDelTenant(req.params.id, req);
  const password = generarPassword();
  await Usuario.update(p.id_usuario, { password_hash: await bcrypt.hash(password, 10) });
  res.json({ usuario: p.usuario, password });
});

/** DELETE /porteros/:id — sólo sin lecturas registradas; si ya trabajó, se desactiva (se conserva el historial). */
exports.eliminar = asyncHandler(async (req, res) => {
  const p = await porteroDelTenant(req.params.id, req);
  if (await Portero.tieneLecturas(p.id_usuario)) {
    throw new AppError(409, 'El portero ya registró lecturas en la puerta: desactivalo para conservar el historial');
  }
  await Usuario.remove(p.id_usuario); // ON DELETE CASCADE borra la fila de porteros
  res.status(204).end();
});
