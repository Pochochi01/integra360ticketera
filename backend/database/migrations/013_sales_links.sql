-- Links de venta del ADMINISTRADOR del complejo: https://<frontend>/venta/:linkId, compartibles en redes.
--
-- A diferencia de links_venta (vendedores), estos links tienen STOCK PROPIO, que se descuenta sólo cuando
-- MercadoPago confirma el pago (webhook / verificación con el token del complejo), nunca al crear la
-- preferencia. Modalidades:
--   reutilizable = 1  vende hasta agotar stock_disponible (cada compra elige la cantidad)
--   reutilizable = 0  link único: admite UNA venta aprobada (por stock_total entradas) y queda agotado
--
-- Correspondencia con el pedido:
--   sales_links.producto / precio  → nombre visible y precio unitario del link (puede ser promocional);
--                                    id_tipo indica qué tipo de entrada se emite (QR reales, Portería)
--   tickets (link_id, tenant_id, buyer_name, buyer_email, estado)
--                                  → vista sales_link_tickets sobre ventas + pagos (3FN, sin duplicar)
--   estado approved/pending/rejected → mismo criterio que la vista reservations (010)
CREATE TABLE IF NOT EXISTS sales_links (
  id               VARCHAR(16)   NOT NULL PRIMARY KEY COMMENT 'código público del link (/venta/:id)',
  tenant_id        INT           NOT NULL,
  id_tipo          INT           NOT NULL COMMENT 'tipo de entrada que se emite',
  producto         VARCHAR(120)  NOT NULL,
  precio           DECIMAL(10,2) NOT NULL,
  stock_total      INT UNSIGNED  NOT NULL,
  stock_disponible INT UNSIGNED  NOT NULL,
  reutilizable     TINYINT(1)    NOT NULL DEFAULT 1,
  activo           TINYINT(1)    NOT NULL DEFAULT 1 COMMENT 'el admin puede pausarlo',
  creado_por       INT           NULL,
  creado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_link_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id_tenant) ON DELETE CASCADE,
  CONSTRAINT fk_sales_link_tipo FOREIGN KEY (id_tipo) REFERENCES tipos_ticket(id_tipo) ON DELETE CASCADE,
  CONSTRAINT fk_sales_link_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  CONSTRAINT chk_sales_link_stock CHECK (stock_disponible <= stock_total AND stock_total BETWEEN 1 AND 100000),
  CONSTRAINT chk_sales_link_precio CHECK (precio > 0),
  INDEX idx_sales_link_tenant (tenant_id, creado_en)
);

-- Venta originada en un sales_link. stock_descontado = 1 cuando el pago se aprobó y ya se restó del link
-- (garantiza que una notificación repetida no descuente dos veces).
CREATE TABLE IF NOT EXISTS ventas_sales_link (
  id_venta         INT          NOT NULL PRIMARY KEY,
  id_sales_link    VARCHAR(16)  NOT NULL,
  cantidad         SMALLINT UNSIGNED NOT NULL,
  stock_descontado TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_vsl_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
  CONSTRAINT fk_vsl_link FOREIGN KEY (id_sales_link) REFERENCES sales_links(id) ON DELETE CASCADE,
  INDEX idx_vsl_link (id_sales_link)
);

CREATE OR REPLACE VIEW sales_link_tickets AS
SELECT v.id_venta AS id,
       vsl.id_sales_link AS link_id,
       sl.tenant_id,
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
