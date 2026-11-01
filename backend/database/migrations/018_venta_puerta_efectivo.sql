-- Venta en puerta en EFECTIVO (y datos de operación de toda venta de boletería).
--
-- ventas.metodo_pago ya admite 'efectivo' (migración 008): no se agrega un campo nuevo ni texto libre.
--
-- id_usuario_staff     quién registró la venta en la boletería (admin del complejo). Para las ventas en efectivo
--                      también queda en pagos.id_validador (quién recibió el dinero).
-- observaciones        nota opcional del staff (ej. «pagó con billete de 10.000»).
-- clave_idempotencia   UUID que genera la pantalla por cada operación: un doble click, un reintento de red o dos
--                      pedidos simultáneos con la misma clave registran UNA sola venta (UNIQUE).
-- Compatible con producción: columnas NULL, no se tocan filas existentes.
ALTER TABLE ventas
  ADD COLUMN id_usuario_staff INT NULL COMMENT 'quién registró la venta en la boletería',
  ADD COLUMN observaciones VARCHAR(255) NULL,
  ADD COLUMN clave_idempotencia CHAR(36) NULL,
  ADD UNIQUE INDEX uq_venta_idempotencia (clave_idempotencia),
  ADD CONSTRAINT fk_venta_staff FOREIGN KEY (id_usuario_staff) REFERENCES usuarios(id_usuario) ON DELETE SET NULL;
