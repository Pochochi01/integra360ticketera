-- Links de pago generados por vendedores: MercadoPago (por defecto) o efectivo (si el complejo lo habilita).
--
-- Correspondencia con el pedido:
--   complexes.efectivo_habilitado  → tenants.efectivo_habilitado
--   reservations                   → ventas (una venta pendiente ES la reserva: retiene el stock)
--   reservations.tipo_pago         → ventas.metodo_pago (+ valor 'efectivo')
--   tickets.validado               → se deduce de tickets.estado: 'pendiente' = no validado,
--                                    'valido' / 'usado' = validado (no se guarda dos veces, 3FN).
--                                    La Portería sólo deja entrar tickets 'valido'.
--   quién y cuándo validó el efectivo → pagos (proveedor 'efectivo', id_validador, validado_en)

ALTER TABLE tenants
  ADD COLUMN efectivo_habilitado TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'los vendedores pueden generar links de pago en efectivo';

ALTER TABLE ventas
  MODIFY metodo_pago ENUM('mercadopago','transferencia','tarjeta','billetera','cortesia','efectivo') NOT NULL,
  ADD COLUMN expira_en DATETIME NULL COMMENT 'fin de la reserva (links de vendedor); NULL = según el método',
  ADD INDEX idx_venta_expira (estado, expira_en);

ALTER TABLE pagos
  MODIFY proveedor ENUM('mercadopago','transferencia','simulado','cortesia','efectivo') NOT NULL,
  ADD COLUMN id_validador INT NULL COMMENT 'admin que confirmó el cobro (efectivo / transferencia)' AFTER detalle,
  ADD COLUMN validado_en DATETIME NULL AFTER id_validador,
  ADD CONSTRAINT fk_pago_validador FOREIGN KEY (id_validador) REFERENCES usuarios(id_usuario) ON DELETE SET NULL;

-- Reservas con su modalidad de pago y el flag "validado" de cada ticket (vista: sin duplicar datos)
CREATE OR REPLACE VIEW reservas AS
SELECT v.id_venta AS id_reserva,
       e.id_tenant,
       v.id_vendedor,
       v.id_evento,
       v.metodo_pago AS tipo_pago,
       v.estado AS estado_reserva,
       v.expira_en,
       t.id_ticket,
       t.estado AS estado_ticket,
       t.estado IN ('valido','usado') AS validado
  FROM ventas v
  JOIN eventos e ON e.id_evento = v.id_evento
  JOIN tickets t ON t.id_venta = v.id_venta;
