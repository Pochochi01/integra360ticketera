const pool = require('../config/db');

const ListaEspera = {
  inscribir: async (idTipo, idUsuario, cantidad) => {
    await pool.query(
      `INSERT INTO lista_espera (id_tipo, id_usuario, cantidad) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad), estado = 'esperando', creado_en = NOW()`,
      [idTipo, idUsuario, cantidad]
    );
  },

  findByUsuario: async (idUsuario) =>
    (await pool.query(
      `SELECT le.*, tt.nombre_tipo, tt.stock_disponible, e.id_evento, e.nombre AS evento, e.fecha AS fecha_evento
         FROM lista_espera le
         JOIN tipos_ticket tt ON tt.id_tipo = le.id_tipo
         JOIN eventos e ON e.id_evento = tt.id_evento
        WHERE le.id_usuario = ? AND le.estado <> 'cancelado'
        ORDER BY le.creado_en DESC`,
      [idUsuario]
    ))[0],

  findByTipo: async (idTipo) =>
    (await pool.query(
      `SELECT le.*, u.nombre, u.email FROM lista_espera le JOIN usuarios u ON u.id_usuario = le.id_usuario
        WHERE le.id_tipo = ? ORDER BY le.creado_en`,
      [idTipo]
    ))[0],

  cancelar: async (id, idUsuario) =>
    (await pool.query("UPDATE lista_espera SET estado = 'cancelado' WHERE id_espera = ? AND id_usuario = ?", [id, idUsuario]))[0].affectedRows,

  /** Al liberarse stock, notifica (en orden de llegada) a quienes esperan hasta cubrir las unidades liberadas. */
  notificarLiberacion: async (idTipo, unidades, db = pool) => {
    const [espera] = await db.query(
      "SELECT * FROM lista_espera WHERE id_tipo = ? AND estado = 'esperando' ORDER BY creado_en",
      [idTipo]
    );
    let restantes = unidades;
    for (const e of espera) {
      if (restantes <= 0) break;
      await db.query("UPDATE lista_espera SET estado = 'notificado' WHERE id_espera = ?", [e.id_espera]);
      // Punto de integración para email/push real
      console.log(`[lista-espera] Notificado usuario ${e.id_usuario}: hay stock en tipo ${idTipo}`);
      restantes -= e.cantidad;
    }
  },
};

module.exports = ListaEspera;
