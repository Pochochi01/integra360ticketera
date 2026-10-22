const pool = require('../config/db');
const { AppError } = require('../utils/errors');

/**
 * Estadísticas de un evento para el panel del admin (GET /api/admin/event/:id/stats).
 *
 * Sólo cuentan las ventas CONFIRMADAS (ventas.estado = 'pagado'): con MercadoPago eso ocurre cuando el
 * webhook (o la vuelta del comprador) trae el pago 'approved', así que cada consulta ya refleja los pagos
 * acreditados al instante, sin caché. Las pendientes se informan aparte (checkouts en curso).
 *
 * Correspondencia con el pedido: events → eventos (+ tipos_ticket para el stock), tickets → tickets + ventas
 * (monto en ventas.monto_total), users → usuarios + vendedores. Los canales sin vendedor se separan en
 * «Links del complejo» (sales_links, cada uno por su nombre) y «Venta directa» (web / emisión del admin).
 */

// Tickets que siguen vigentes dentro de una venta pagada
const TICKET_VIGENTE = "t.estado NOT IN ('cancelado','reembolsado')";

/** Canal de cada venta: vendedor, link del complejo o venta directa. Clave estable para agrupar y colorear. */
const CANAL = `
  CASE WHEN v.id_vendedor IS NOT NULL THEN CONCAT('vendedor:', v.id_vendedor)
       WHEN vsl.id_sales_link IS NOT NULL THEN CONCAT('link:', vsl.id_sales_link)
       ELSE 'directa' END`;
const NOMBRE_CANAL = `
  CASE WHEN v.id_vendedor IS NOT NULL THEN CONCAT_WS(' ', uv.nombre, uv.apellido)
       WHEN vsl.id_sales_link IS NOT NULL THEN CONCAT('Link: ', sl.producto)
       ELSE 'Venta directa' END`;
const JOIN_CANAL = `
  LEFT JOIN vendedores vd ON vd.id_vendedor = v.id_vendedor
  LEFT JOIN usuarios uv ON uv.id_usuario = vd.id_usuario
  LEFT JOIN ventas_sales_link vsl ON vsl.id_venta = v.id_venta
  LEFT JOIN sales_links sl ON sl.id = vsl.id_sales_link`;

const num = (x) => Number(x) || 0;

const estadisticasEvento = async (idEvento, idTenant) => {
  const [[evento]] = await pool.query(
    `SELECT e.id_evento, e.nombre, e.fecha, e.lugar, e.estado, e.imagen_evento,
            COALESCE(SUM(tt.stock_total), 0) AS stock_total, COALESCE(SUM(tt.stock_disponible), 0) AS stock_disponible
       FROM eventos e LEFT JOIN tipos_ticket tt ON tt.id_evento = e.id_evento
      WHERE e.id_evento = ? AND e.id_tenant = ?
      GROUP BY e.id_evento`,
    [idEvento, idTenant]
  );
  if (!evento) throw new AppError(404, 'Evento no encontrado');

  // Una pasada por venta: unidades vigentes (subconsulta agregada, evita duplicar monto_total por ticket)
  const BASE = `
    FROM ventas v
    JOIN (SELECT t.id_venta, COUNT(*) AS unidades FROM tickets t WHERE ${TICKET_VIGENTE} GROUP BY t.id_venta) tk ON tk.id_venta = v.id_venta
    ${JOIN_CANAL}
   WHERE v.id_evento = ?`;

  const [[totales]] = await pool.query(
    `SELECT COUNT(CASE WHEN v.estado = 'pagado' THEN 1 END) AS ventas,
            COALESCE(SUM(CASE WHEN v.estado = 'pagado' THEN tk.unidades END), 0) AS unidades,
            COALESCE(SUM(CASE WHEN v.estado = 'pagado' THEN v.monto_total END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN v.estado = 'pagado' AND v.metodo_pago = 'mercadopago' THEN v.monto_total END), 0) AS ingresos_mercadopago,
            COUNT(CASE WHEN v.estado = 'pendiente' THEN 1 END) AS pendientes,
            COALESCE(SUM(CASE WHEN v.estado = 'pendiente' THEN tk.unidades END), 0) AS unidades_pendientes,
            COALESCE(SUM(CASE WHEN v.estado = 'pendiente' THEN v.monto_total END), 0) AS monto_pendiente,
            MAX(CASE WHEN v.estado = 'pagado' THEN v.fecha_venta END) AS ultima_venta
       ${BASE}`,
    [idEvento]
  );

  const [porCanal] = await pool.query(
    `SELECT clave, nombre, es_vendedor, COUNT(*) AS ventas, SUM(unidades) AS unidades, SUM(monto_total) AS monto
       FROM (SELECT ${CANAL} AS clave, ${NOMBRE_CANAL} AS nombre, v.id_vendedor IS NOT NULL AS es_vendedor, tk.unidades, v.monto_total
               ${BASE} AND v.estado = 'pagado') x
      GROUP BY clave, nombre, es_vendedor
      ORDER BY monto DESC, unidades DESC`,
    [idEvento]
  );

  const [porTipo] = await pool.query(
    `SELECT tt.id_tipo, tt.nombre_tipo AS nombre, tt.precio, tt.stock_total, tt.stock_disponible,
            COUNT(CASE WHEN v.estado = 'pagado' THEN t.id_ticket END) AS unidades
       FROM tipos_ticket tt
       LEFT JOIN tickets t ON t.id_tipo = tt.id_tipo AND ${TICKET_VIGENTE}
       LEFT JOIN ventas v ON v.id_venta = t.id_venta
      WHERE tt.id_evento = ?
      GROUP BY tt.id_tipo
      ORDER BY tt.precio DESC, tt.id_tipo`,
    [idEvento]
  );

  const [porMetodo] = await pool.query(
    `SELECT v.metodo_pago AS metodo, COUNT(*) AS ventas, SUM(tk.unidades) AS unidades, SUM(v.monto_total) AS monto
       ${BASE} AND v.estado = 'pagado'
      GROUP BY v.metodo_pago ORDER BY monto DESC`,
    [idEvento]
  );

  // Evolución diaria (últimos 30 días con ventas confirmadas)
  const [porDia] = await pool.query(
    `SELECT DATE_FORMAT(v.fecha_venta, '%Y-%m-%d') AS dia, SUM(tk.unidades) AS unidades, SUM(v.monto_total) AS monto
       ${BASE} AND v.estado = 'pagado' AND v.fecha_venta >= CURDATE() - INTERVAL 29 DAY
      GROUP BY dia ORDER BY dia`,
    [idEvento]
  );

  const stockTotal = num(evento.stock_total);
  return {
    evento: { ...evento, stock_total: stockTotal, stock_disponible: num(evento.stock_disponible) },
    generales: {
      ventas: num(totales.ventas),
      unidades: num(totales.unidades),
      ingresos: num(totales.ingresos),
      ingresos_mercadopago: num(totales.ingresos_mercadopago),
      ticket_promedio: totales.unidades ? Math.round((num(totales.ingresos) / num(totales.unidades)) * 100) / 100 : 0,
      ocupacion: stockTotal ? Math.round((num(totales.unidades) / stockTotal) * 1000) / 10 : 0, // % del stock vendido
      pendientes: { ventas: num(totales.pendientes), unidades: num(totales.unidades_pendientes), monto: num(totales.monto_pendiente) },
      ultima_venta: totales.ultima_venta,
    },
    por_vendedor: porCanal.map((c) => ({ clave: c.clave, nombre: c.nombre, es_vendedor: Boolean(c.es_vendedor), ventas: num(c.ventas), unidades: num(c.unidades), monto: num(c.monto) })),
    por_tipo: porTipo.map((t) => ({ id_tipo: t.id_tipo, nombre: t.nombre, precio: num(t.precio), stock_total: t.stock_total, stock_disponible: t.stock_disponible, unidades: num(t.unidades) })),
    por_metodo: porMetodo.map((m) => ({ metodo: m.metodo, ventas: num(m.ventas), unidades: num(m.unidades), monto: num(m.monto) })),
    por_dia: porDia.map((d) => ({ dia: d.dia, unidades: num(d.unidades), monto: num(d.monto) })),
    actualizado_en: new Date().toISOString(),
  };
};

module.exports = { estadisticasEvento };
