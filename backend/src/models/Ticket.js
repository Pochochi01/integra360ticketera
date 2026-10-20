const pool = require('../config/db');
const { ETIQUETA } = require('./Asiento');

/**
 * El tenant y la etiqueta de asiento NO se guardan en tickets (3FN): se derivan del evento y del asiento.
 * Se exponen igual (id_tenant, asiento) para que los controladores no dependan del esquema físico.
 */
const SELECT_TICKET = `
  SELECT t.id_ticket, e.id_tenant, t.id_venta, t.id_tipo, t.id_usuario, t.codigo_qr, t.estado, t.id_asiento, t.fecha_uso,
         ${ETIQUETA} AS asiento,
         tt.nombre_tipo, tt.precio, e.id_evento, e.nombre AS evento, e.fecha AS fecha_evento, e.lugar, e.estado AS estado_evento,
         e.imagen_evento, v.estado AS estado_venta, v.metodo_pago, v.id_usuario AS id_comprador,
         CONCAT_WS(' ', u.nombre, u.apellido) AS titular, u.email AS email_titular
    FROM tickets t
    JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo
    JOIN eventos e ON e.id_evento = tt.id_evento
    JOIN ventas v ON v.id_venta = t.id_venta
    JOIN usuarios u ON u.id_usuario = t.id_usuario
    LEFT JOIN asientos a ON a.id_asiento = t.id_asiento`;

const ESTADOS_ACTIVOS = ['pendiente', 'valido', 'usado'];

const Ticket = {
  ESTADOS_ACTIVOS,

  findAll: async ({ id_tenant, id_evento, estado } = {}) => {
    const filtros = [];
    const params = [];
    if (id_tenant) { filtros.push('e.id_tenant = ?'); params.push(id_tenant); }
    if (id_evento) { filtros.push('e.id_evento = ?'); params.push(id_evento); }
    if (estado) { filtros.push('t.estado = ?'); params.push(estado); }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    return (await pool.query(`${SELECT_TICKET} ${where} ORDER BY t.id_ticket DESC`, params))[0];
  },

  findByUsuario: async (idUsuario) =>
    (await pool.query(`${SELECT_TICKET} WHERE t.id_usuario = ? ORDER BY e.fecha, t.id_ticket`, [idUsuario]))[0],

  findByVenta: async (idVenta, db = pool) =>
    (await db.query(`${SELECT_TICKET} WHERE t.id_venta = ? ORDER BY t.id_ticket`, [idVenta]))[0],

  findById: async (id, db = pool) => (await db.query(`${SELECT_TICKET} WHERE t.id_ticket = ?`, [id]))[0][0],

  lockById: async (id, db) => (await db.query(`${SELECT_TICKET} WHERE t.id_ticket = ? FOR UPDATE`, [id]))[0][0],

  lockByCodigo: async (codigo, db) => (await db.query(`${SELECT_TICKET} WHERE t.codigo_qr = ? FOR UPDATE`, [codigo]))[0][0],

  /** Tickets activos que el usuario ya posee para un evento (para el límite por persona). */
  contarActivosUsuarioEvento: async (idUsuario, idEvento, db = pool) =>
    (await db.query(
      `SELECT COUNT(*) AS n FROM tickets t JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo
        WHERE t.id_usuario = ? AND tt.id_evento = ? AND t.estado IN (?)`,
      [idUsuario, idEvento, ESTADOS_ACTIVOS]
    ))[0][0].n,

  /** filas: [id_venta, id_tipo, id_usuario, codigo_qr, estado, id_asiento] */
  createMany: (filas, db) =>
    db.query('INSERT INTO tickets (id_venta, id_tipo, id_usuario, codigo_qr, estado, id_asiento) VALUES ?', [filas]),

  setEstadoPorVenta: (idVenta, estado, db) =>
    db.query("UPDATE tickets SET estado = ? WHERE id_venta = ? AND estado IN ('pendiente','valido')", [estado, idVenta]),

  validarPorVenta: (idVenta, db) => db.query("UPDATE tickets SET estado = 'valido' WHERE id_venta = ? AND estado = 'pendiente'", [idVenta]),

  transferir: (id, idDestino, nuevoCodigo, db) =>
    db.query('UPDATE tickets SET id_usuario = ?, codigo_qr = ? WHERE id_ticket = ?', [idDestino, nuevoCodigo, id]),

  marcarUsado: (id, db) => db.query("UPDATE tickets SET estado = 'usado', fecha_uso = NOW() WHERE id_ticket = ?", [id]),
};

module.exports = Ticket;
