-- Venta en portería digital: compra por QR en la puerta y cobro asistido en boletería.
--
-- ventas.origen   de dónde salió la venta, para estadísticas de puerta (el flujo de pago es el de siempre):
--                   NULL             → canales existentes (web, vendedores, links)
--                   'puerta_qr'      → el cliente escaneó el QR de compra del evento y pagó desde su celular
--                   'puerta_asistida'→ boletería: el staff generó el cobro y el cliente pagó escaneando el QR de pago
-- Compatible con producción: columna NULL, no toca filas existentes.
ALTER TABLE ventas
  ADD COLUMN origen ENUM('puerta_qr','puerta_asistida') NULL COMMENT 'venta en portería (NULL = canales existentes)',
  ADD INDEX idx_venta_evento_origen (id_evento, origen, estado);

-- Auditoría de notificaciones de MercadoPago: cada webhook recibido con su resultado. Permite reconstruir qué
-- llegó, cuándo y qué se hizo (aprobado, duplicado ignorado, monto inválido, reembolso, error → reintento).
CREATE TABLE IF NOT EXISTS mercadopago_notificaciones (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  payment_id   VARCHAR(40) NOT NULL,
  ambito       INT NULL COMMENT 'id_tenant (0 = plataforma; NULL = cuenta no vinculada)',
  id_venta     INT NULL,
  estado       VARCHAR(20) NULL COMMENT 'estado resultante (aprobado, pendiente, rechazado, reembolsado…)',
  resultado    VARCHAR(255) NULL COMMENT 'qué hizo el sistema o por qué ignoró la notificación',
  http_status  SMALLINT NOT NULL,
  recibido_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mpn_payment (payment_id),
  INDEX idx_mpn_venta (id_venta),
  INDEX idx_mpn_fecha (recibido_en)
);
