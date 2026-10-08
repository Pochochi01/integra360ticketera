-- Portería: vista `entradas` (qr_code, estado, fecha_ingreso).
--
-- Es una vista y no una tabla para no duplicar datos (3FN): el estado de cada entrada vive en
-- `tickets` y se actualiza en la misma transacción que valida el acceso, así que la vista nunca
-- queda desincronizada. El registro de cada lectura (válida o no) está en `accesos`.
CREATE OR REPLACE VIEW entradas AS
SELECT t.id_ticket,
       t.codigo_qr AS qr_code,
       CASE t.estado
         WHEN 'usado' THEN 'ingresado'
         WHEN 'valido' THEN 'habilitada'
         ELSE t.estado
       END AS estado,
       t.fecha_uso AS fecha_ingreso,
       tt.id_evento
  FROM tickets t
  JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo;

-- Historial de la Portería por fecha (las consultas ordenan por fecha descendente)
CREATE INDEX idx_accesos_fecha ON accesos (fecha);
