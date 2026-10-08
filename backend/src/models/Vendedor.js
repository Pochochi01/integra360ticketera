const pool = require('../config/db');

/**
 * Vendedor = pertenencia de un usuario a un complejo como punto de venta.
 * Los datos personales (nombre, apellido, dni, whatsapp, email) viven en usuarios (3FN) y se exponen con JOIN.
 */
const STATS = `
  (SELECT COUNT(*) FROM ventas v WHERE v.id_vendedor = vd.id_vendedor AND v.estado = 'pagado') AS ventas_pagadas,
  (SELECT COALESCE(SUM(v.monto_total),0) FROM ventas v WHERE v.id_vendedor = vd.id_vendedor AND v.estado = 'pagado') AS monto_vendido,
  (SELECT COUNT(*) FROM tickets t JOIN ventas v ON v.id_venta = t.id_venta
    WHERE v.id_vendedor = vd.id_vendedor AND t.estado IN ('valido','usado')) AS tickets_vendidos`;

const SELECT = `
  SELECT vd.id_vendedor, vd.id_tenant, vd.id_usuario, vd.estado, vd.creado_en,
         u.nombre, u.apellido, u.dni, u.whatsapp, u.email, ${STATS}
    FROM vendedores vd JOIN usuarios u ON u.id_usuario = vd.id_usuario`;

const Vendedor = {
  findByTenant: async (idTenant) => (await pool.query(`${SELECT} WHERE vd.id_tenant = ? ORDER BY u.apellido, u.nombre`, [idTenant]))[0],

  findById: async (id, db = pool) => (await db.query(`${SELECT} WHERE vd.id_vendedor = ?`, [id]))[0][0],

  findByUsuario: async (idUsuario) => (await pool.query(`${SELECT} WHERE vd.id_usuario = ?`, [idUsuario]))[0][0],

  /** Devuelve qué dato choca con otro vendedor del mismo complejo (DNI / WhatsApp), o null. */
  duplicado: async (idTenant, { dni, whatsapp }, excluirId = 0, db = pool) => {
    const [rows] = await db.query(
      `SELECT u.dni, u.whatsapp FROM vendedores vd JOIN usuarios u ON u.id_usuario = vd.id_usuario
        WHERE vd.id_tenant = ? AND vd.id_vendedor <> ? AND (u.dni = ? OR u.whatsapp = ?) FOR UPDATE`,
      [idTenant, excluirId, dni ?? '', whatsapp ?? '']
    );
    if (!rows.length) return null;
    return rows.some((r) => r.dni === dni) ? 'DNI' : 'WhatsApp';
  },

  create: async ({ id_tenant, id_usuario, estado = 'activo' }, db) =>
    (await db.query('INSERT INTO vendedores (id_tenant, id_usuario, estado) VALUES (?, ?, ?)', [id_tenant, id_usuario, estado]))[0].insertId,

  setEstado: (id, estado, db = pool) => db.query('UPDATE vendedores SET estado = ? WHERE id_vendedor = ?', [estado, id]),

  tieneVentas: async (id) => (await pool.query('SELECT 1 FROM ventas WHERE id_vendedor = ? LIMIT 1', [id]))[0].length > 0,

  remove: (id, db) => db.query('DELETE FROM vendedores WHERE id_vendedor = ?', [id]),
};

module.exports = Vendedor;
