const pool = require('../config/db');

/**
 * Portero = pertenencia de un usuario (rol "portero") a un complejo, con su nombre de usuario de ingreso.
 * Nombre y contraseña viven en usuarios (3FN) y se exponen con JOIN; el hash nunca sale del modelo.
 */
const SELECT = `
  SELECT po.id_portero, po.id_tenant, po.id_usuario, po.usuario, po.estado, po.creado_en,
         u.nombre, u.apellido, u.rol,
         (SELECT COUNT(*) FROM accesos ac WHERE ac.id_validador = po.id_usuario) AS lecturas,
         (SELECT COUNT(*) FROM accesos ac WHERE ac.id_validador = po.id_usuario AND ac.resultado = 'valido') AS ingresos,
         (SELECT MAX(ac.fecha) FROM accesos ac WHERE ac.id_validador = po.id_usuario) AS ultima_lectura
    FROM porteros po JOIN usuarios u ON u.id_usuario = po.id_usuario`;

const Portero = {
  findByTenant: async (idTenant) =>
    (await pool.query(`${SELECT} WHERE po.id_tenant = ? ORDER BY po.estado, u.nombre, u.apellido`, [idTenant]))[0],

  findById: async (id, db = pool) => (await db.query(`${SELECT} WHERE po.id_portero = ?`, [id]))[0][0],

  findByUsuario: async (idUsuario, db = pool) => (await db.query(`${SELECT} WHERE po.id_usuario = ?`, [idUsuario]))[0][0],

  /** Nombres de usuario ya tomados que empiezan con la base dada (para elegir uno libre). */
  usuariosConPrefijo: async (base, db = pool) =>
    (await db.query('SELECT usuario FROM porteros WHERE usuario LIKE ?', [`${base.replace(/[%_]/g, '\$&')}%`]))[0].map((r) => r.usuario),

  create: async ({ id_tenant, id_usuario, usuario, estado = 'activo' }, db) =>
    (await db.query('INSERT INTO porteros (id_tenant, id_usuario, usuario, estado) VALUES (?, ?, ?, ?)', [id_tenant, id_usuario, usuario, estado]))[0].insertId,

  setEstado: (id, estado, db = pool) => db.query('UPDATE porteros SET estado = ? WHERE id_portero = ?', [estado, id]),

  tieneLecturas: async (idUsuario) => (await pool.query('SELECT 1 FROM accesos WHERE id_validador = ? LIMIT 1', [idUsuario]))[0].length > 0,
};

module.exports = Portero;
