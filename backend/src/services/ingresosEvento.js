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

  return {
    evento,
    generales: {
      vendidas, ingresadas, pendientes: suma('pendientes'),
      facturado, consumido, pendiente_monto: Math.round((facturado - consumido) * 100) / 100,
      porcentaje_ingreso: uso, semaforo: semaforo(uso),
      capacidad, capacidad_utilizada: pct(ingresadas, capacidad),
      ultimo_ingreso: ultimos.at(-1) || null,
    },
    por_tipo: porTipo,
    actualizado_en: new Date().toISOString(),
  };
};

module.exports = { ingresosEvento, semaforo };
