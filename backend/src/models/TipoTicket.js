const pool = require('../config/db');

const TipoTicket = {
  findByEvento: async (idEvento, { incluirSoloAdmin = false } = {}) =>
    (await pool.query(
      `SELECT * FROM tipos_ticket WHERE id_evento = ? ${incluirSoloAdmin ? '' : 'AND solo_admin = 0 AND activo = 1'} ORDER BY precio`,
      [idEvento]
    ))[0],

  findById: async (id, db = pool) => (await db.query('SELECT * FROM tipos_ticket WHERE id_tipo = ?', [id]))[0][0],

  /** Bloquea las filas de los tipos para descontar stock sin condiciones de carrera. */
  lockByIds: async (ids, db) =>
    (await db.query('SELECT * FROM tipos_ticket WHERE id_tipo IN (?) FOR UPDATE', [ids]))[0],

  create: async (idEvento, d) => {
    const [r] = await pool.query(
      `INSERT INTO tipos_ticket (id_evento, nombre_tipo, precio, stock_total, stock_disponible, condiciones, venta_desde, venta_hasta, solo_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [idEvento, d.nombre_tipo, d.precio, d.stock_total, d.stock_total, d.condiciones || null,
        d.venta_desde || null, d.venta_hasta || null, d.solo_admin ? 1 : 0]
    );
    return TipoTicket.findById(r.insertId);
  },

  /** Al cambiar stock_total se ajusta stock_disponible en la misma diferencia. */
  update: async (id, d) => {
    const actual = await TipoTicket.findById(id);
    if (!actual) return null;
    const nuevoTotal = d.stock_total !== undefined ? Number(d.stock_total) : actual.stock_total;
    const vendidos = actual.stock_total - actual.stock_disponible;
    if (nuevoTotal < vendidos) return { error: `No se puede bajar el stock por debajo de lo vendido (${vendidos})` };
    await pool.query(
      `UPDATE tipos_ticket SET nombre_tipo = ?, precio = ?, stock_total = ?, stock_disponible = ?, condiciones = ?,
              venta_desde = ?, venta_hasta = ?, solo_admin = ?, activo = ? WHERE id_tipo = ?`,
      [
        d.nombre_tipo ?? actual.nombre_tipo,
        d.precio ?? actual.precio,
        nuevoTotal,
        nuevoTotal - vendidos,
        d.condiciones ?? actual.condiciones,
        d.venta_desde !== undefined ? d.venta_desde || null : actual.venta_desde,
        d.venta_hasta !== undefined ? d.venta_hasta || null : actual.venta_hasta,
        d.solo_admin !== undefined ? (d.solo_admin ? 1 : 0) : actual.solo_admin,
        d.activo !== undefined ? (d.activo ? 1 : 0) : actual.activo,
        id,
      ]
    );
    return TipoTicket.findById(id);
  },

  remove: async (id) => (await pool.query('DELETE FROM tipos_ticket WHERE id_tipo = ?', [id]))[0].affectedRows,

  tieneTickets: async (id) => (await pool.query('SELECT 1 FROM tickets WHERE id_tipo = ? LIMIT 1', [id]))[0].length > 0,

  descontarStock: (id, cantidad, db) =>
    db.query('UPDATE tipos_ticket SET stock_disponible = stock_disponible - ? WHERE id_tipo = ?', [cantidad, id]),

  devolverStock: (id, cantidad, db) =>
    db.query('UPDATE tipos_ticket SET stock_disponible = LEAST(stock_total, stock_disponible + ?) WHERE id_tipo = ?', [cantidad, id]),
};

module.exports = TipoTicket;
