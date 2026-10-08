const pool = require('../config/db');

const Evento = {
  /** id_tenant: filtra por tenant (null = todos, vista marketplace). */
  findAll: async ({ id_tenant = null, incluirNoPublicados = false } = {}) => {
    const filtros = [];
    const params = [];
    if (!incluirNoPublicados) filtros.push("e.estado IN ('publicado','agotado')");
    if (id_tenant) { filtros.push('e.id_tenant = ?'); params.push(id_tenant); }
    const [rows] = await pool.query(
      `SELECT e.*, tn.nombre AS tenant, tn.slug AS tenant_slug,
              MIN(t.precio) AS precio_desde,
              COALESCE(SUM(t.stock_disponible), 0) AS stock_disponible
         FROM eventos e
         JOIN tenants tn ON tn.id_tenant = e.id_tenant AND tn.estado = 'activo'
         LEFT JOIN tipos_ticket t ON t.id_evento = e.id_evento AND t.activo = 1 AND t.solo_admin = 0
        ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
        GROUP BY e.id_evento
        ORDER BY e.fecha`,
      params
    );
    return rows;
  },

  findById: async (id, db = pool) =>
    (await db.query(
      `SELECT e.*, tn.nombre AS tenant, tn.slug AS tenant_slug, tn.estado AS estado_tenant
         FROM eventos e JOIN tenants tn ON tn.id_tenant = e.id_tenant WHERE e.id_evento = ?`,
      [id]
    ))[0][0],

  create: async (idTenant, d) => {
    const [r] = await pool.query(
      `INSERT INTO eventos (id_tenant, nombre, descripcion, fecha, lugar, limite_por_persona, tiene_seating, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idTenant, d.nombre, d.descripcion || null, d.fecha, d.lugar, d.limite_por_persona || null, d.tiene_seating ? 1 : 0, d.estado || 'publicado']
    );
    return Evento.findById(r.insertId);
  },

  update: async (id, d) => {
    const permitidos = ['nombre', 'descripcion', 'fecha', 'lugar', 'limite_por_persona', 'tiene_seating', 'estado'];
    const campos = Object.keys(d).filter((k) => permitidos.includes(k));
    if (campos.length) {
      const valores = campos.map((c) => {
        if (c === 'limite_por_persona') return d[c] ? Number(d[c]) : null;
        if (c === 'tiene_seating') return d[c] ? 1 : 0;
        return d[c];
      });
      await pool.query(`UPDATE eventos SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id_evento = ?`, [...valores, id]);
    }
    return Evento.findById(id);
  },

  /** Ruta relativa de la imagen (dentro de /uploads) o null para quitarla. */
  setImagen: (id, ruta) => pool.query('UPDATE eventos SET imagen_evento = ? WHERE id_evento = ?', [ruta, id]),

  remove: async (id) => (await pool.query('DELETE FROM eventos WHERE id_evento = ?', [id]))[0].affectedRows,

  tieneVentas: async (id) =>
    (await pool.query('SELECT 1 FROM ventas WHERE id_evento = ? LIMIT 1', [id]))[0].length > 0,

  /** Recalcula 'agotado' / 'publicado' según stock público restante. */
  actualizarEstadoPorStock: async (id, db = pool) => {
    await db.query(
      `UPDATE eventos e
          SET e.estado = IF((SELECT COALESCE(SUM(stock_disponible),0) FROM tipos_ticket
                              WHERE id_evento = e.id_evento AND activo = 1 AND solo_admin = 0) = 0, 'agotado', 'publicado')
        WHERE e.id_evento = ? AND e.estado IN ('publicado','agotado')`,
      [id]
    );
  },
};

module.exports = Evento;
