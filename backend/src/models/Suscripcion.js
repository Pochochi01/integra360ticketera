const pool = require('../config/db');

const Plan = {
  findAll: async () => (await pool.query('SELECT * FROM planes ORDER BY precio_mensual'))[0],
  findById: async (id) => (await pool.query('SELECT * FROM planes WHERE id_plan = ?', [id]))[0][0],
  create: async ({ nombre, descripcion, precio_mensual }) =>
    (await pool.query('INSERT INTO planes (nombre, descripcion, precio_mensual) VALUES (?, ?, ?)', [nombre, descripcion || null, precio_mensual]))[0].insertId,
  update: (id, { nombre, descripcion, precio_mensual, activo }) =>
    pool.query(
      'UPDATE planes SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion), precio_mensual = COALESCE(?, precio_mensual), activo = COALESCE(?, activo) WHERE id_plan = ?',
      [nombre ?? null, descripcion ?? null, precio_mensual ?? null, activo === undefined ? null : activo ? 1 : 0, id]
    ),
};

const SELECT = `
  SELECT s.*, p.nombre AS plan, p.precio_mensual, t.nombre AS tenant,
         IF(s.estado = 'activa' AND s.vence_el < CURDATE(), 'vencida', s.estado) AS estado_actual
    FROM suscripciones s JOIN planes p ON p.id_plan = s.id_plan JOIN tenants t ON t.id_tenant = s.id_tenant`;

const Suscripcion = {
  findByTenant: async (idTenant, db = pool) => (await db.query(`${SELECT} WHERE s.id_tenant = ?`, [idTenant]))[0][0],
  findById: async (id, db = pool) => (await db.query(`${SELECT} WHERE s.id_suscripcion = ?`, [id]))[0][0],
  lockById: async (id, db) => (await db.query('SELECT * FROM suscripciones WHERE id_suscripcion = ? FOR UPDATE', [id]))[0][0],

  /** Asigna o cambia el plan de un tenant (una suscripción por tenant). */
  asignarPlan: async (idTenant, idPlan) => {
    await pool.query(
      `INSERT INTO suscripciones (id_tenant, id_plan) VALUES (?, ?) ON DUPLICATE KEY UPDATE id_plan = VALUES(id_plan)`,
      [idTenant, idPlan]
    );
    return Suscripcion.findByTenant(idTenant);
  },

  /** Registra un mes pago: extiende el vencimiento desde hoy o desde el vencimiento vigente. */
  extenderUnMes: (id, db) =>
    db.query(
      `UPDATE suscripciones
          SET estado = 'activa',
              vence_el = DATE_ADD(IF(vence_el IS NULL OR vence_el < CURDATE(), CURDATE(), vence_el), INTERVAL 1 MONTH)
        WHERE id_suscripcion = ?`,
      [id]
    ),

  setEstado: (id, estado) => pool.query('UPDATE suscripciones SET estado = ? WHERE id_suscripcion = ?', [estado, id]),
};

module.exports = { Plan, Suscripcion };
