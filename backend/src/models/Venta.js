const pool = require('../config/db');

/**
 * Columnas derivadas (no almacenadas, 3FN):
 *  - id_tenant            ← eventos.id_tenant
 *  - id_link/codigo_link  ← ventas_link
 *  - referencia_pago      ← último pago de la venta
 *  - whatsapp_enviado_en  ← último mensaje de entradas enviado
 */
const SELECT_VENTA = `
  SELECT v.*, e.id_tenant, e.nombre AS evento, e.fecha AS fecha_evento, e.imagen_evento,
         CONCAT_WS(' ', u.nombre, u.apellido) AS comprador, u.email AS email_comprador,
         tn.nombre AS tenant,
         CONCAT_WS(' ', uv.nombre, uv.apellido) AS vendedor,
         vl.id_link, l.codigo AS codigo_link,
         (SELECT COALESCE(p.referencia_externa, p.preference_id) FROM pagos p WHERE p.id_venta = v.id_venta ORDER BY p.id_pago DESC LIMIT 1) AS referencia_pago,
         (SELECT MAX(m.creado_en) FROM mensajes_whatsapp m WHERE m.id_venta = v.id_venta AND m.tipo = 'entradas' AND m.estado = 'enviado') AS whatsapp_enviado_en,
         (SELECT COUNT(*) FROM tickets t WHERE t.id_venta = v.id_venta) AS cantidad_tickets
    FROM ventas v
    JOIN eventos e ON e.id_evento = v.id_evento
    JOIN tenants tn ON tn.id_tenant = e.id_tenant
    JOIN usuarios u ON u.id_usuario = v.id_usuario
    LEFT JOIN vendedores vd ON vd.id_vendedor = v.id_vendedor
    LEFT JOIN usuarios uv ON uv.id_usuario = vd.id_usuario
    LEFT JOIN ventas_link vl ON vl.id_venta = v.id_venta
    LEFT JOIN links_venta l ON l.id_link = vl.id_link`;

const Venta = {
  /** Listado filtrable; id_tenant es obligatorio para el panel de un complejo. */
  findAll: async ({ id_tenant, estado, id_evento, id_vendedor } = {}) => {
    const filtros = [];
    const params = [];
    if (id_tenant) { filtros.push('e.id_tenant = ?'); params.push(id_tenant); }
    if (estado) { filtros.push('v.estado = ?'); params.push(estado); }
    if (id_evento) { filtros.push('v.id_evento = ?'); params.push(id_evento); }
    if (id_vendedor === 'ninguno') filtros.push('v.id_vendedor IS NULL');
    else if (id_vendedor) { filtros.push('v.id_vendedor = ?'); params.push(id_vendedor); }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    return (await pool.query(`${SELECT_VENTA} ${where} ORDER BY v.fecha_venta DESC, v.id_venta DESC`, params))[0];
  },

  findByUsuario: async (idUsuario) =>
    (await pool.query(`${SELECT_VENTA} WHERE v.id_usuario = ? ORDER BY v.fecha_venta DESC, v.id_venta DESC`, [idUsuario]))[0],

  findById: async (id, db = pool) => (await db.query(`${SELECT_VENTA} WHERE v.id_venta = ?`, [id]))[0][0],

  findByToken: async (token) => (await pool.query(`${SELECT_VENTA} WHERE v.token_acceso = ?`, [token]))[0][0],

  /** Bloquea la venta; incluye el tenant (derivado del evento). */
  lockById: async (id, db) =>
    (await db.query(
      'SELECT v.*, e.id_tenant FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento WHERE v.id_venta = ? FOR UPDATE',
      [id]
    ))[0][0],

  create: async (d, db) => {
    const [r] = await db.query(
      `INSERT INTO ventas (id_usuario, id_vendedor, id_evento, monto_total, estado, metodo_pago, tipo_venta, empresa, whatsapp_contacto, token_acceso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.id_usuario, d.id_vendedor || null, d.id_evento, d.monto_total, d.estado, d.metodo_pago, d.tipo_venta || 'normal',
        d.empresa || null, d.whatsapp_contacto || null, d.token_acceso]
    );
    if (d.id_link) await db.query('INSERT INTO ventas_link (id_venta, id_link) VALUES (?, ?)', [r.insertId, d.id_link]);
    return r.insertId;
  },

  setEstado: (id, estado, db) => db.query('UPDATE ventas SET estado = ? WHERE id_venta = ?', [estado, id]),

  setWhatsapp: (id, whatsapp) => pool.query('UPDATE ventas SET whatsapp_contacto = ? WHERE id_venta = ?', [whatsapp, id]),
};

module.exports = Venta;
