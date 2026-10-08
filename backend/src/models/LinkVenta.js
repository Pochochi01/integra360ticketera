const pool = require('../config/db');
const { generarCodigoLink } = require('../utils/qr');

const SELECT = `
  SELECT l.*, e.nombre AS evento, e.fecha AS fecha_evento,
         (SELECT COUNT(*) FROM ventas_link vl JOIN ventas v ON v.id_venta = vl.id_venta
           WHERE vl.id_link = l.id_link AND v.estado = 'pagado') AS ventas_pagadas,
         (SELECT COALESCE(SUM(v.monto_total),0) FROM ventas_link vl JOIN ventas v ON v.id_venta = vl.id_venta
           WHERE vl.id_link = l.id_link AND v.estado = 'pagado') AS monto_vendido,
         (SELECT COUNT(*) FROM mensajes_whatsapp m WHERE m.id_link = l.id_link AND m.estado = 'enviado') AS envios_whatsapp
    FROM links_venta l
    LEFT JOIN eventos e ON e.id_evento = l.id_evento`;

const LinkVenta = {
  findByVendedor: async (idVendedor) =>
    (await pool.query(`${SELECT} WHERE l.id_vendedor = ? ORDER BY l.creado_en DESC, l.id_link DESC`, [idVendedor]))[0],

  findById: async (id) => (await pool.query(`${SELECT} WHERE l.id_link = ?`, [id]))[0][0],

  /** Resuelve un código con vendedor, tenant y evento (para la página pública y la compra). */
  findByCodigo: async (codigo, db = pool) =>
    (await db.query(
      `SELECT l.*, vd.id_tenant, u.nombre AS vendedor_nombre, u.apellido AS vendedor_apellido, vd.estado AS estado_vendedor,
              t.nombre AS tenant, t.slug AS tenant_slug, t.estado AS estado_tenant,
              e.nombre AS evento, e.estado AS estado_evento, e.imagen_evento
         FROM links_venta l
         JOIN vendedores vd ON vd.id_vendedor = l.id_vendedor
         JOIN usuarios u ON u.id_usuario = vd.id_usuario
         JOIN tenants t ON t.id_tenant = vd.id_tenant
         LEFT JOIN eventos e ON e.id_evento = l.id_evento
        WHERE l.codigo = ?`,
      [codigo]
    ))[0][0],

  /** Crea el link reintentando si el código aleatorio choca con uno existente. */
  create: async ({ id_vendedor, id_evento = null, descripcion = null }, db = pool) => {
    for (let intento = 0; intento < 5; intento++) {
      try {
        const [r] = await db.query('INSERT INTO links_venta (id_vendedor, id_evento, codigo, descripcion) VALUES (?, ?, ?, ?)', [
          id_vendedor, id_evento, generarCodigoLink(), descripcion,
        ]);
        return r.insertId;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    throw new Error('No se pudo generar un código de link único');
  },

  setActivo: (id, activo) => pool.query('UPDATE links_venta SET activo = ? WHERE id_link = ?', [activo ? 1 : 0, id]),

  registrarVisita: (id) => pool.query('UPDATE links_venta SET visitas = visitas + 1 WHERE id_link = ?', [id]),
};

module.exports = LinkVenta;
