const pool = require('../config/db');
const { AppError } = require('../utils/errors');

/**
 * Control de ingresos de un evento (GET /api/admin/event/:id/ingresos) — dashboard del módulo Porteros.
 *
 * Por tipo de entrada: vendidas, ingresadas, pendientes, % de uso, monto vendido / consumido / pendiente.
 *   vendida   = ticket vigente de una venta pagada (estado 'valido' o 'usado')
 *   ingresada = ticket 'usado' (la Portería lo validó: tickets.estado + fecha_uso)
 *   pendiente = ticket 'valido' (todavía no entró)
 *   monto     = lo que realmente se cobró por ese ticket: monto de la venta prorrateado entre sus tickets
 *               (respeta precios promocionales de links y cortesías en $0; no usa el precio de lista)
 * Los tickets en efectivo sin validar ('pendiente') todavía no cuentan como vendidos.
 *
 * Una sola consulta agrupada (sin N+1): el prorrateo se calcula en una tabla derivada por venta.
 * Sin caché: el panel la consulta cada 10 s para seguir los ingresos en vivo.
 */
const num = (x) => Number(x) || 0;
const pct = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : 0);
/** Semáforo del uso: verde ≥ 70 %, amarillo 40–69 %, rojo < 40 %. */
const semaforo = (uso) => (uso >= 70 ? 'alto' : uso >= 40 ? 'medio' : 'bajo');
/** Semáforo de capacidad (lugares libres del total): verde > 50 %, amarillo 10–50 %, rojo ≤ 10 % o agotado. */
const semaforoCapacidad = (libre) => (libre > 50 ? 'libre' : libre > 10 ? 'ajustada' : 'critica');
const ESTADO_PAGO_SQL = `CASE WHEN v.estado = 'pagado' THEN 'approved' WHEN v.estado = 'reembolsado' THEN 'refunded'
  WHEN v.estado = 'cancelado' THEN 'cancelled'
  WHEN (SELECT p.estado FROM pagos p WHERE p.id_venta = v.id_venta ORDER BY p.id_pago DESC LIMIT 1) = 'rechazado' THEN 'rejected'
  ELSE 'pending' END`;

const ingresosEvento = async (idEvento, idTenant) => {
  const [[evento]] = await pool.query(
    'SELECT id_evento, nombre, fecha, lugar, estado FROM eventos WHERE id_evento = ? AND id_tenant = ?', [idEvento, idTenant]);
  if (!evento) throw new AppError(404, 'Evento no encontrado');

  const [filas] = await pool.query(
    `SELECT tt.id_tipo, tt.nombre_tipo AS nombre, tt.precio, tt.stock_total, tt.solo_admin, tt.activo,
            COUNT(t.id_ticket) AS vendidas,
            COALESCE(SUM(t.estado = 'usado'), 0) AS ingresadas,
            COALESCE(SUM(t.estado = 'valido'), 0) AS pendientes,
            COALESCE(SUM(pv.monto_ticket), 0) AS monto_vendido,
            COALESCE(SUM(CASE WHEN t.estado = 'usado' THEN pv.monto_ticket END), 0) AS monto_consumido,
            MAX(t.fecha_uso) AS ultimo_ingreso
       FROM tipos_ticket tt
       -- JOIN anidado: el prorrateo (pv) sólo se une a tickets reales del tipo, nunca a tipos sin ventas
       LEFT JOIN (
              tickets t
              JOIN (
                SELECT v.id_venta, v.monto_total / COUNT(tk.id_ticket) AS monto_ticket
                  FROM ventas v JOIN tickets tk ON tk.id_venta = v.id_venta
                 WHERE v.id_evento = ? AND v.estado = 'pagado'
                 GROUP BY v.id_venta, v.monto_total
              ) pv ON pv.id_venta = t.id_venta
            ) ON t.id_tipo = tt.id_tipo AND t.estado IN ('valido','usado')
      WHERE tt.id_evento = ?
      GROUP BY tt.id_tipo, tt.nombre_tipo, tt.precio, tt.stock_total, tt.solo_admin, tt.activo
      ORDER BY tt.id_tipo`,
    [idEvento, idEvento]
  );

  const porTipo = filas.map((f) => {
    const vendidas = num(f.vendidas);
    const ingresadas = num(f.ingresadas);
    const montoVendido = Math.round(num(f.monto_vendido) * 100) / 100;
    const montoConsumido = Math.round(num(f.monto_consumido) * 100) / 100;
    const uso = pct(ingresadas, vendidas);
    return {
      id_tipo: f.id_tipo, nombre: f.nombre, precio: num(f.precio), capacidad: num(f.stock_total),
      solo_admin: Boolean(f.solo_admin), activo: Boolean(f.activo),
      vendidas, ingresadas, pendientes: num(f.pendientes), uso, semaforo: semaforo(uso),
      monto_vendido: montoVendido, monto_consumido: montoConsumido,
      monto_pendiente: Math.round((montoVendido - montoConsumido) * 100) / 100,
      ultimo_ingreso: f.ultimo_ingreso,
    };
  });

  const suma = (k) => porTipo.reduce((s, t) => s + t[k], 0);
  const vendidas = suma('vendidas');
  const ingresadas = suma('ingresadas');
  const capacidad = suma('capacidad');
  const facturado = Math.round(suma('monto_vendido') * 100) / 100;
  const consumido = Math.round(suma('monto_consumido') * 100) / 100;
  const ultimos = porTipo.map((t) => t.ultimo_ingreso).filter(Boolean).sort();
  const uso = pct(ingresadas, vendidas);

  // Ventas en puerta (QR de compra y boletería asistida): sólo pagadas
  const [puertaFilas] = await pool.query(
    `SELECT v.origen, COUNT(DISTINCT v.id_venta) AS ventas, COUNT(t.id_ticket) AS tickets
       FROM ventas v JOIN tickets t ON t.id_venta = v.id_venta AND t.estado IN ('valido','usado')
      WHERE v.id_evento = ? AND v.estado = 'pagado' AND v.origen IS NOT NULL
      GROUP BY v.origen`, [idEvento]);
  const [puertaMontos] = await pool.query(
    `SELECT origen, COALESCE(SUM(monto_total), 0) AS monto FROM ventas
      WHERE id_evento = ? AND estado = 'pagado' AND origen IS NOT NULL GROUP BY origen`, [idEvento]);
  const puerta = { tickets: 0, ventas: 0, monto: 0, por_origen: {} };
  for (const o of ['puerta_qr', 'puerta_asistida']) {
    const f = puertaFilas.find((x) => x.origen === o) || {};
    const m = puertaMontos.find((x) => x.origen === o) || {};
    puerta.por_origen[o] = { tickets: num(f.tickets), ventas: num(f.ventas), monto: Math.round(num(m.monto) * 100) / 100 };
    puerta.tickets += num(f.tickets); puerta.ventas += num(f.ventas); puerta.monto += puerta.por_origen[o].monto;
  }

  // Últimas operaciones del evento (cualquier canal), con tipos de entrada y estado del pago
  const [ultimas] = await pool.query(
    `SELECT v.id_venta, v.fecha_venta, v.metodo_pago, v.origen, v.monto_total, ${ESTADO_PAGO_SQL} AS estado_pago,
            CONCAT_WS(' ', u.nombre, u.apellido) AS comprador,
            (SELECT GROUP_CONCAT(DISTINCT tt.nombre_tipo ORDER BY tt.nombre_tipo SEPARATOR ', ')
               FROM tickets t2 JOIN tipos_ticket tt ON tt.id_tipo = t2.id_tipo WHERE t2.id_venta = v.id_venta) AS tipos,
            (SELECT COUNT(*) FROM tickets t3 WHERE t3.id_venta = v.id_venta) AS cantidad
       FROM ventas v JOIN usuarios u ON u.id_usuario = v.id_usuario
      WHERE v.id_evento = ?
      ORDER BY v.fecha_venta DESC, v.id_venta DESC LIMIT 10`, [idEvento]);

  // Ventas por método de pago (pagadas): del evento completo y de la puerta. Una consulta agrupada.
  const [porMetodoFilas] = await pool.query(
    `SELECT v.metodo_pago, (v.origen IS NOT NULL) AS en_puerta, COUNT(*) AS operaciones, COALESCE(SUM(v.monto_total), 0) AS monto,
            COALESCE(SUM((SELECT COUNT(*) FROM tickets t WHERE t.id_venta = v.id_venta AND t.estado IN ('valido','usado'))), 0) AS tickets
       FROM ventas v WHERE v.id_evento = ? AND v.estado = 'pagado'
      GROUP BY v.metodo_pago, en_puerta`, [idEvento]);
  const resumenMetodos = (filas) => {
    const porMetodo = {};
    for (const f of filas) {
      const m = (porMetodo[f.metodo_pago] ??= { operaciones: 0, tickets: 0, monto: 0 });
      m.operaciones += num(f.operaciones); m.tickets += num(f.tickets); m.monto += num(f.monto);
    }
    const totalMonto = Object.values(porMetodo).reduce((s, m) => s + m.monto, 0);
    const totalOps = Object.values(porMetodo).reduce((s, m) => s + m.operaciones, 0);
    for (const m of Object.values(porMetodo)) {
      m.monto = Math.round(m.monto * 100) / 100;
      m.porcentaje_monto = pct(m.monto, totalMonto);
      m.porcentaje_operaciones = pct(m.operaciones, totalOps);
    }
    // MercadoPago y efectivo siempre presentes (aunque sea en 0) para que el panel los muestre separados
    for (const k of ['mercadopago', 'efectivo']) porMetodo[k] ??= { operaciones: 0, tickets: 0, monto: 0, porcentaje_monto: 0, porcentaje_operaciones: 0 };
    return { por_metodo: porMetodo, total: { operaciones: totalOps, monto: Math.round(totalMonto * 100) / 100 } };
  };
  const metodosEvento = resumenMetodos(porMetodoFilas);
  const metodosPuerta = resumenMetodos(porMetodoFilas.filter((f) => Number(f.en_puerta) === 1));

  const libre = capacidad ? Math.max(0, capacidad - ingresadas) : 0;
  const librePct = pct(libre, capacidad);

  return {
    evento,
    generales: {
      vendidas, ingresadas, pendientes: suma('pendientes'),
      facturado, consumido, pendiente_monto: Math.round((facturado - consumido) * 100) / 100,
      porcentaje_ingreso: uso, semaforo: semaforo(uso),
      capacidad, capacidad_utilizada: pct(ingresadas, capacidad),
      capacidad_disponible: libre, capacidad_disponible_pct: librePct, semaforo_capacidad: semaforoCapacidad(librePct),
      ultimo_ingreso: ultimos.at(-1) || null,
    },
    por_tipo: porTipo,
    puerta: { ...puerta, monto: Math.round(puerta.monto * 100) / 100, por_metodo: metodosPuerta.por_metodo },
    // Ventas pagadas del evento por método: operaciones, tickets, recaudación y porcentajes (separados y combinados)
    metodos_pago: metodosEvento,
    ultimas_operaciones: ultimas.map((u) => ({
      id_venta: u.id_venta, fecha: u.fecha_venta, comprador: u.comprador, tipos: u.tipos, cantidad: num(u.cantidad),
      metodo_pago: u.metodo_pago, origen: u.origen, estado_pago: u.estado_pago, monto: num(u.monto_total),
    })),
    actualizado_en: new Date().toISOString(),
  };
};

module.exports = { ingresosEvento, semaforo, semaforoCapacidad };
