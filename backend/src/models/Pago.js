const pool = require('../config/db');

/** Registro de cobros (ventas de tickets o suscripciones de tenants). Un intento = una fila. */
const Pago = {
  create: async ({ id_venta = null, id_suscripcion = null, proveedor, estado = 'pendiente', monto, preference_id = null, referencia_externa = null, detalle = null }, db = pool) =>
    (await db.query(
      `INSERT INTO pagos (id_venta, id_suscripcion, proveedor, estado, monto, preference_id, referencia_externa, detalle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id_venta, id_suscripcion, proveedor, estado, monto, preference_id, referencia_externa, detalle]
    ))[0].insertId,

  findById: async (id, db = pool) => (await db.query('SELECT * FROM pagos WHERE id_pago = ?', [id]))[0][0],

  lockById: async (id, db) => (await db.query('SELECT * FROM pagos WHERE id_pago = ? FOR UPDATE', [id]))[0][0],

  findByVenta: async (idVenta) => (await pool.query('SELECT * FROM pagos WHERE id_venta = ? ORDER BY id_pago DESC', [idVenta]))[0],

  findBySuscripcion: async (idSus) =>
    (await pool.query('SELECT * FROM pagos WHERE id_suscripcion = ? ORDER BY id_pago DESC', [idSus]))[0],

  /** Último pago pendiente de un proveedor para la venta (para reutilizar la preferencia de MercadoPago). */
  pendienteDeVenta: async (idVenta, proveedor, db = pool) =>
    (await db.query(
      "SELECT * FROM pagos WHERE id_venta = ? AND proveedor = ? AND estado = 'pendiente' ORDER BY id_pago DESC LIMIT 1",
      [idVenta, proveedor]
    ))[0][0],

  actualizar: (id, { estado, referencia_externa, detalle, preference_id }, db = pool) =>
    db.query(
      `UPDATE pagos SET estado = COALESCE(?, estado), referencia_externa = COALESCE(?, referencia_externa),
              detalle = COALESCE(?, detalle), preference_id = COALESCE(?, preference_id) WHERE id_pago = ?`,
      [estado || null, referencia_externa || null, detalle || null, preference_id || null, id]
    ),

  /** Registra quién confirmó un cobro manual (efectivo / transferencia). */
  registrarValidacion: (id, idValidador, db = pool) =>
    db.query('UPDATE pagos SET id_validador = ?, validado_en = NOW() WHERE id_pago = ?', [idValidador, id]),

  /** Cierra los pagos abiertos de una venta al cancelarla / reembolsarla. */
  cerrarPorVenta: (idVenta, estadoVenta, db) =>
    db.query(
      `UPDATE pagos SET estado = IF(estado = 'aprobado', IF(? = 'reembolsado', 'reembolsado', estado), IF(estado = 'pendiente', 'cancelado', estado))
        WHERE id_venta = ?`,
      [estadoVenta, idVenta]
    ),
};

module.exports = Pago;
