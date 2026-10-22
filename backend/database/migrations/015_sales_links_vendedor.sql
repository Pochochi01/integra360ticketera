-- Links reutilizables también para VENDEDORES: el mismo sales_links del admin, con el vendedor dueño.
--   seller_id NULL  → link del complejo (lo generó el admin): comportamiento de siempre
--   seller_id = N   → link del vendedor N: cada venta queda atribuida a él (ventas.id_vendedor, que heredan
--                     sus tickets), así aparece en «Mis ventas», en las estadísticas por vendedor y en reportes
-- Compatible con producción: columna nueva NULL, sin tocar las filas existentes.
ALTER TABLE sales_links
  ADD COLUMN seller_id INT NULL COMMENT 'vendedor dueño del link (NULL = link del complejo)' AFTER tenant_id,
  ADD CONSTRAINT fk_sales_link_vendedor FOREIGN KEY (seller_id) REFERENCES vendedores(id_vendedor) ON DELETE SET NULL,
  ADD INDEX idx_sales_link_vendedor (seller_id, creado_en);

-- Compras de un link con el vendedor, el evento y el teléfono del comprador
CREATE OR REPLACE VIEW sales_link_tickets AS
SELECT v.id_venta AS id,
       vsl.id_sales_link AS link_id,
       sl.tenant_id,
       v.id_vendedor AS seller_id,
       v.id_evento AS event_id,
       CONCAT_WS(' ', u.nombre, u.apellido) AS buyer_name,
       u.email AS buyer_email,
       v.whatsapp_contacto AS buyer_phone,
       vsl.cantidad,
       v.monto_total,
       CASE
         WHEN v.estado = 'pagado' THEN 'approved'
         WHEN v.estado = 'reembolsado' THEN 'refunded'
         WHEN v.estado = 'cancelado' THEN 'cancelled'
         WHEN (SELECT p.estado FROM pagos p WHERE p.id_venta = v.id_venta ORDER BY p.id_pago DESC LIMIT 1) = 'rechazado' THEN 'rejected'
         ELSE 'pending'
       END AS estado,
       vsl.stock_descontado,
       v.fecha_venta AS creado_en
  FROM ventas_sales_link vsl
  JOIN sales_links sl ON sl.id = vsl.id_sales_link
  JOIN ventas v ON v.id_venta = vsl.id_venta
  JOIN usuarios u ON u.id_usuario = v.id_usuario;

-- Vista por TICKET con los campos del pedido (seller_id, event_id, comprador, estado, monto). El vendedor, el
-- comprador y el monto viven en la venta (3FN): cada ticket los toma de ahí. monto = precio prorrateado del ticket.
CREATE OR REPLACE VIEW tickets_detalle AS
SELECT t.id_ticket AS id,
       t.id_venta AS venta_id,
       v.id_evento AS event_id,
       e.id_tenant AS tenant_id,
       v.id_vendedor AS seller_id,
       CONCAT_WS(' ', u.nombre, u.apellido) AS buyer_name,
       u.email AS buyer_email,
       v.whatsapp_contacto AS buyer_phone,
       CASE
         WHEN v.estado = 'pagado' THEN 'approved'
         WHEN v.estado = 'reembolsado' THEN 'refunded'
         WHEN v.estado = 'cancelado' THEN 'cancelled'
         WHEN (SELECT p.estado FROM pagos p WHERE p.id_venta = v.id_venta ORDER BY p.id_pago DESC LIMIT 1) = 'rechazado' THEN 'rejected'
         ELSE 'pending'
       END AS estado,
       ROUND(v.monto_total / (SELECT COUNT(*) FROM tickets t2 WHERE t2.id_venta = v.id_venta), 2) AS monto,
       t.estado AS estado_ticket,
       v.fecha_venta AS creado_en
  FROM tickets t
  JOIN ventas v ON v.id_venta = t.id_venta
  JOIN eventos e ON e.id_evento = v.id_evento
  JOIN usuarios u ON u.id_usuario = v.id_usuario;
