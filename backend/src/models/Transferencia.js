const pool = require('../config/db');

const Transferencia = {
  create: (d, db) =>
    db.query(
      `INSERT INTO transferencias_ticket (id_ticket, id_usuario_origen, id_usuario_destino, codigo_qr_anterior)
       VALUES (?, ?, ?, ?)`,
      [d.id_ticket, d.id_usuario_origen, d.id_usuario_destino, d.codigo_qr_anterior]
    ),

  /** Transferencias enviadas o recibidas por un usuario. */
  findByUsuario: async (idUsuario) =>
    (await pool.query(
      `SELECT tr.*, uo.nombre AS origen, uo.email AS email_origen, ud.nombre AS destino, ud.email AS email_destino,
              e.nombre AS evento, tt.nombre_tipo,
              IF(tr.id_usuario_origen = ?, 'enviada', 'recibida') AS direccion
         FROM transferencias_ticket tr
         JOIN usuarios uo ON uo.id_usuario = tr.id_usuario_origen
         JOIN usuarios ud ON ud.id_usuario = tr.id_usuario_destino
         JOIN tickets t ON t.id_ticket = tr.id_ticket
         JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo
         JOIN eventos e ON e.id_evento = tt.id_evento
        WHERE tr.id_usuario_origen = ? OR tr.id_usuario_destino = ?
        ORDER BY tr.fecha_transferencia DESC`,
      [idUsuario, idUsuario, idUsuario]
    ))[0],

  findByTicket: async (idTicket) =>
    (await pool.query('SELECT * FROM transferencias_ticket WHERE id_ticket = ? ORDER BY fecha_transferencia', [idTicket]))[0],
};

module.exports = Transferencia;
