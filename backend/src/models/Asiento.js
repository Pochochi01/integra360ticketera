const pool = require('../config/db');

/** El evento de un asiento se obtiene de su tipo de ticket (3FN: id_tipo → id_evento). */
const ETIQUETA = "CONCAT(a.sector, ' ', a.fila, '-', a.numero)";

const Asiento = {
  ETIQUETA,

  /** Asientos del evento con indicador de ocupación (ticket activo). */
  findByEvento: async (idEvento) =>
    (await pool.query(
      `SELECT a.*, tt.id_evento, ${ETIQUETA} AS etiqueta, (t.id_ticket IS NOT NULL) AS ocupado
         FROM asientos a
         JOIN tipos_ticket tt ON tt.id_tipo = a.id_tipo
         LEFT JOIN tickets t ON t.asiento_activo = a.id_asiento
        WHERE tt.id_evento = ?
        ORDER BY a.sector, a.fila, a.numero`,
      [idEvento]
    ))[0],

  /** Bloquea y devuelve los asientos pedidos con su evento y ocupación actual. */
  lockByIds: async (ids, db) =>
    (await db.query(
      `SELECT a.*, tt.id_evento, ${ETIQUETA} AS etiqueta,
              (SELECT COUNT(*) FROM tickets t WHERE t.asiento_activo = a.id_asiento) AS ocupado
         FROM asientos a JOIN tipos_ticket tt ON tt.id_tipo = a.id_tipo
        WHERE a.id_asiento IN (?) FOR UPDATE`,
      [ids]
    ))[0],

  /** Genera filas × números para un tipo de ticket. */
  generar: async (idTipo, { sector, filas, asientos_por_fila }) => {
    const valores = [];
    for (const fila of filas) {
      for (let n = 1; n <= asientos_por_fila; n++) valores.push([idTipo, sector, fila, n]);
    }
    const [r] = await pool.query('INSERT IGNORE INTO asientos (id_tipo, sector, fila, numero) VALUES ?', [valores]);
    return r.affectedRows;
  },
};

module.exports = Asiento;
