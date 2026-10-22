const pool = require('../config/db');
const { generarCodigoLink } = require('../utils/qr');

const SELECT = `
  SELECT sl.*, tt.nombre_tipo AS tipo, tt.id_evento, e.nombre AS evento, e.fecha AS fecha_evento,
         tt.stock_disponible AS stock_evento, tt.activo AS tipo_activo, e.estado AS estado_evento,
         CONCAT_WS(' ', uv.nombre, uv.apellido) AS vendedor, vd.estado AS estado_vendedor,
         (SELECT COUNT(*) FROM tickets tk JOIN ventas v ON v.id_venta = tk.id_venta
           WHERE tk.id_tipo = sl.id_tipo AND v.estado = 'pendiente' AND tk.estado = 'pendiente') AS reservadas_evento,
         (SELECT COUNT(*) FROM ventas_sales_link vsl JOIN ventas v ON v.id_venta = vsl.id_venta
           WHERE vsl.id_sales_link = sl.id AND v.estado = 'pagado') AS ventas_aprobadas,
         (SELECT COUNT(*) FROM ventas_sales_link vsl JOIN ventas v ON v.id_venta = vsl.id_venta
           WHERE vsl.id_sales_link = sl.id AND v.estado = 'pendiente') AS ventas_pendientes
    FROM sales_links sl
    JOIN tipos_ticket tt ON tt.id_tipo = sl.id_tipo
    JOIN eventos e ON e.id_evento = tt.id_evento
    LEFT JOIN vendedores vd ON vd.id_vendedor = sl.seller_id
    LEFT JOIN usuarios uv ON uv.id_usuario = vd.id_usuario`;

/** Links de venta del administrador con stock propio (migración 013). */
const SalesLink = {
  findByTenant: async (idTenant) =>
    (await pool.query(`${SELECT} WHERE sl.tenant_id = ? ORDER BY sl.creado_en DESC`, [idTenant]))[0],

  /** Links reutilizables de un vendedor (seller_id). */
  findByVendedor: async (idVendedor) =>
    (await pool.query(`${SELECT} WHERE sl.seller_id = ? ORDER BY sl.creado_en DESC`, [idVendedor]))[0],

  findById: async (id, db = pool) => (await db.query(`${SELECT} WHERE sl.id = ?`, [id]))[0][0],

  /** Crea el link reintentando si el código aleatorio choca con uno existente. */
  create: async ({ tenant_id, seller_id = null, id_tipo, producto, precio, stock_total, reutilizable, creado_por }) => {
    for (let intento = 0; intento < 5; intento++) {
      const id = generarCodigoLink();
      try {
        await pool.query(
          `INSERT INTO sales_links (id, tenant_id, seller_id, id_tipo, producto, precio, stock_total, stock_disponible, reutilizable, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tenant_id, seller_id, id_tipo, producto, precio, stock_total, stock_total, reutilizable ? 1 : 0, creado_por]
        );
        return id;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    throw new Error('No se pudo generar un código de link único');
  },

  /** idVendedor: si viene, sólo actúa sobre links de ese vendedor (el admin puede tocar todos los del complejo). */
  setActivo: (id, idTenant, activo, idVendedor = null) =>
    pool.query(`UPDATE sales_links SET activo = ? WHERE id = ? AND tenant_id = ?${idVendedor ? ' AND seller_id = ?' : ''}`,
      [activo ? 1 : 0, id, idTenant, ...(idVendedor ? [idVendedor] : [])]),

  vincularVenta: (idVenta, idLink, cantidad, db = pool) =>
    db.query('INSERT INTO ventas_sales_link (id_venta, id_sales_link, cantidad) VALUES (?, ?, ?)', [idVenta, idLink, cantidad]),

  /**
   * Descuenta el stock del link por una venta cuyo pago MercadoPago ya aprobó. Llamar dentro de la
   * transacción del pago, con la venta bloqueada. Devuelve:
   *   null   la venta no viene de un sales_link
   *   true   descontado ahora (o ya lo estaba: idempotente ante notificaciones repetidas)
   *   false  el link se agotó antes (otra compra aprobada ganó el stock): hay que reembolsar
   * Link único: la primera venta aprobada lo deja en 0, sin importar la cantidad.
   */
  descontarPorVenta: async (conn, idVenta) => {
    const [[vsl]] = await conn.query('SELECT * FROM ventas_sales_link WHERE id_venta = ? FOR UPDATE', [idVenta]);
    if (!vsl) return null;
    if (vsl.stock_descontado) return true;
    const [r] = await conn.query(
      `UPDATE sales_links SET stock_disponible = IF(reutilizable, stock_disponible - ?, 0)
        WHERE id = ? AND stock_disponible >= ? AND stock_disponible > 0`,
      [vsl.cantidad, vsl.id_sales_link, vsl.cantidad]
    );
    if (!r.affectedRows) return false;
    await conn.query('UPDATE ventas_sales_link SET stock_descontado = 1 WHERE id_venta = ?', [idVenta]);
    return true;
  },

  /** Estado por venta (vista sales_link_tickets). */
  tickets: async (id, idTenant, idVendedor = null) =>
    (await pool.query(`SELECT * FROM sales_link_tickets WHERE link_id = ? AND tenant_id = ?${idVendedor ? ' AND seller_id = ?' : ''} ORDER BY creado_en DESC`,
      [id, idTenant, ...(idVendedor ? [idVendedor] : [])]))[0],
};

module.exports = SalesLink;
