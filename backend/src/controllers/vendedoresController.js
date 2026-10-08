const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const Vendedor = require('../models/Vendedor');
const Usuario = require('../models/Usuario');
const LinkVenta = require('../models/LinkVenta');
const Venta = require('../models/Venta');
const { asegurarTenant } = require('../middlewares/tenant');
const { normalizarWhatsapp } = require('../utils/whatsapp');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * CRUD de vendedores (puntos de venta) para el administrador del tenant.
 * Los datos personales se guardan en `usuarios` (cuenta con rol "vendedor"); `vendedores` guarda
 * sólo la pertenencia al complejo y el estado.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida y normaliza los campos recibidos. parcial=true para ediciones (sólo valida lo enviado). */
const validar = (d, parcial = false) => {
  const r = {};
  for (const campo of ['nombre', 'apellido']) {
    if (d[campo] !== undefined || !parcial) {
      const v = String(d[campo] ?? '').trim();
      if (!v) throw new AppError(400, `El ${campo} es obligatorio`);
      if (v.length > 80) throw new AppError(400, `El ${campo} es demasiado largo`);
      r[campo] = v;
    }
  }
  if (d.dni !== undefined || !parcial) {
    if (!/^\d{6,12}$/.test(String(d.dni ?? ''))) throw new AppError(400, 'DNI inválido (6 a 12 dígitos)');
    r.dni = String(d.dni);
  }
  if (d.whatsapp !== undefined || !parcial) {
    r.whatsapp = normalizarWhatsapp(d.whatsapp, process.env.WHATSAPP_PAIS_DEFECTO || 'AR');
    if (!r.whatsapp) throw new AppError(400, 'Número de WhatsApp inválido (debe ser un celular, ej. +54 9 11 2345 6789)');
  }
  if (d.email !== undefined || !parcial) {
    const email = String(d.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AppError(400, 'Email inválido');
    r.email = email;
  }
  if (d.password || !parcial) {
    if (!d.password || String(d.password).length < 6) throw new AppError(400, 'La contraseña debe tener al menos 6 caracteres');
    r.password = String(d.password);
  }
  if (d.estado !== undefined) {
    if (!['activo', 'inactivo'].includes(d.estado)) throw new AppError(400, 'Estado inválido');
    r.estado = d.estado;
  }
  return r;
};

const vendedorDelTenant = async (id, req) => asegurarTenant(await Vendedor.findById(id), req, 'Vendedor no encontrado');

exports.listar = asyncHandler(async (req, res) => res.json(await Vendedor.findByTenant(req.tenant.id_tenant)));

exports.detalle = asyncHandler(async (req, res) => {
  const v = await vendedorDelTenant(req.params.id, req);
  res.json({ ...v, links: await LinkVenta.findByVendedor(v.id_vendedor) });
});

/** POST /vendedores { nombre, apellido, dni, whatsapp, email, password, estado? } */
exports.crear = asyncHandler(async (req, res) => {
  const d = validar(req.body);
  if (await Usuario.existeEmail(d.email)) throw new AppError(409, 'Ya existe un usuario con ese email');

  const id = await pool.withTransaction(async (conn) => {
    // El control de duplicados bloquea las filas del complejo para evitar altas simultáneas repetidas
    const dup = await Vendedor.duplicado(req.tenant.id_tenant, d, 0, conn);
    if (dup) throw new AppError(409, `Ya existe un vendedor con ese ${dup} en este complejo`);
    const idUsuario = await Usuario.create(
      { nombre: d.nombre, apellido: d.apellido, email: d.email, dni: d.dni, whatsapp: d.whatsapp, password_hash: await bcrypt.hash(d.password, 10), rol: 'vendedor' },
      conn
    );
    const idVendedor = await Vendedor.create({ id_tenant: req.tenant.id_tenant, id_usuario: idUsuario, estado: d.estado || 'activo' }, conn);
    // Todo vendedor arranca con un link general listo para compartir
    await LinkVenta.create({ id_vendedor: idVendedor, descripcion: 'Link general' }, conn);
    return idVendedor;
  });
  res.status(201).json(await Vendedor.findById(id));
});

/** PUT /vendedores/:id — datos personales, estado, email o nueva contraseña. */
exports.actualizar = asyncHandler(async (req, res) => {
  const actual = await vendedorDelTenant(req.params.id, req);
  const d = validar(req.body, true);
  if (d.email && (await Usuario.existeEmail(d.email, actual.id_usuario))) throw new AppError(409, 'Ya existe un usuario con ese email');

  await pool.withTransaction(async (conn) => {
    const dup = await Vendedor.duplicado(req.tenant.id_tenant, { dni: d.dni ?? actual.dni, whatsapp: d.whatsapp ?? actual.whatsapp }, actual.id_vendedor, conn);
    if (dup) throw new AppError(409, `Ya existe un vendedor con ese ${dup} en este complejo`);
    await Usuario.update(
      actual.id_usuario,
      { nombre: d.nombre, apellido: d.apellido, dni: d.dni, whatsapp: d.whatsapp, email: d.email, password_hash: d.password ? await bcrypt.hash(d.password, 10) : undefined },
      conn
    );
    if (d.estado) await Vendedor.setEstado(actual.id_vendedor, d.estado, conn);
  });
  res.json(await Vendedor.findById(actual.id_vendedor));
});

/** DELETE /vendedores/:id — si tiene ventas se desactiva (se conserva la trazabilidad); si no, se elimina. */
exports.eliminar = asyncHandler(async (req, res) => {
  const v = await vendedorDelTenant(req.params.id, req);
  if (await Vendedor.tieneVentas(v.id_vendedor)) {
    await Vendedor.setEstado(v.id_vendedor, 'inactivo');
    return res.json({ mensaje: 'El vendedor tiene ventas registradas: se desactivó en lugar de eliminarse', desactivado: true });
  }
  await pool.withTransaction(async (conn) => {
    await conn.query('UPDATE mensajes_whatsapp m JOIN links_venta l ON l.id_link = m.id_link SET m.id_link = NULL WHERE l.id_vendedor = ?', [v.id_vendedor]);
    await Vendedor.remove(v.id_vendedor, conn); // los links se borran en cascada
    await Usuario.remove(v.id_usuario, conn);
  });
  res.status(204).end();
});

exports.ventas = asyncHandler(async (req, res) => {
  const v = await vendedorDelTenant(req.params.id, req);
  res.json(await Venta.findAll({ id_tenant: req.tenant.id_tenant, id_vendedor: v.id_vendedor, estado: req.query.estado }));
});
