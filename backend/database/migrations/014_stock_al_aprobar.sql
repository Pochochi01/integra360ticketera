-- Stock uniforme por evento: las ventas con MercadoPago descuentan el stock recién cuando el pago se aprueba.
--
-- ventas.stock_descontado
--   1 = la venta ya restó sus entradas de tipos_ticket.stock_disponible (ventas pagadas, cortesías, emisiones,
--       reservas en efectivo / transferencia, y todas las ventas anteriores a esta migración)
--   0 = venta de MercadoPago pendiente: no retiene stock; se descuenta al llegar el pago 'approved'
--       (pagosService.confirmarStockDeVenta). Al cancelarse no hay nada que devolver.
ALTER TABLE ventas
  ADD COLUMN stock_descontado TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = MercadoPago pendiente, el stock se descuenta al aprobarse';

-- Auditoría de cambios del admin sobre eventos y su stock (POST /api/admin/event/:id/update)
CREATE TABLE IF NOT EXISTS auditoria_eventos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  id_evento   INT NOT NULL,
  id_usuario  INT NULL,
  accion      VARCHAR(40) NOT NULL COMMENT 'editar_evento | agregar_stock',
  detalle     JSON NOT NULL COMMENT 'valores antes / después',
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auditoria_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento) ON DELETE CASCADE,
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  INDEX idx_auditoria_evento (id_evento, creado_en)
);

-- Vista "events" del pedido: el stock del evento es la suma de sus tipos de entrada (no se guarda dos veces)
CREATE OR REPLACE VIEW events AS
SELECT e.id_evento AS id,
       e.id_tenant AS tenant_id,
       e.nombre,
       e.fecha,
       e.lugar,
       e.estado,
       COALESCE(SUM(tt.stock_total), 0) AS stock_total,
       COALESCE(SUM(tt.stock_disponible), 0) AS stock_disponible
  FROM eventos e
  LEFT JOIN tipos_ticket tt ON tt.id_evento = e.id_evento AND tt.activo = 1 AND tt.solo_admin = 0
 GROUP BY e.id_evento;
