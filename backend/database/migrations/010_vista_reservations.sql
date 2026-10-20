-- Vista "reservations" (id, tenant_id, seller_id, buyer_name, buyer_email, tipo_pago, estado) sobre las
-- tablas existentes: la reserva ES la venta (ventas) y el estado del pago sale del último registro de pagos.
-- Al ser una vista, el webhook actualiza ventas/pagos y la vista refleja el cambio al instante (sin duplicar).
--
-- estado (vocabulario de MercadoPago):
--   approved   venta pagada                          pending   esperando el pago
--   rejected   el último intento fue rechazado       cancelled reserva vencida o cancelada
--   refunded   reembolsada
CREATE OR REPLACE VIEW reservations AS
SELECT v.id_venta AS id,
       e.id_tenant AS tenant_id,
       v.id_vendedor AS seller_id,
       CONCAT_WS(' ', u.nombre, u.apellido) AS buyer_name,
       u.email AS buyer_email,
       v.whatsapp_contacto AS buyer_phone,
       v.metodo_pago AS tipo_pago,
       CASE
         WHEN v.estado = 'pagado' THEN 'approved'
         WHEN v.estado = 'reembolsado' THEN 'refunded'
         WHEN v.estado = 'cancelado' THEN 'cancelled'
         WHEN (SELECT p.estado FROM pagos p WHERE p.id_venta = v.id_venta ORDER BY p.id_pago DESC LIMIT 1) = 'rechazado' THEN 'rejected'
         ELSE 'pending'
       END AS estado,
       v.monto_total,
       v.expira_en,
       v.fecha_venta AS creado_en
  FROM ventas v
  JOIN eventos e ON e.id_evento = v.id_evento
  JOIN usuarios u ON u.id_usuario = v.id_usuario;
