-- Links de checkout: el vendedor genera /checkout/:linkId (linkId = links_venta.codigo) que abre la página
-- del complejo con un formulario para el comprador. El link puede fijar el "producto":
--   id_evento (ya existía)  NULL = el comprador elige entre los eventos del complejo
--   id_tipo                 NULL = el comprador elige el tipo de entrada
--   cantidad                NULL = el comprador elige la cantidad; si no, se vende exactamente esa cantidad
ALTER TABLE links_venta
  ADD COLUMN id_tipo INT NULL AFTER id_evento,
  ADD COLUMN cantidad SMALLINT UNSIGNED NULL AFTER id_tipo,
  ADD CONSTRAINT fk_link_tipo FOREIGN KEY (id_tipo) REFERENCES tipos_ticket(id_tipo) ON DELETE CASCADE,
  ADD CONSTRAINT chk_link_cantidad CHECK (cantidad IS NULL OR cantidad BETWEEN 1 AND 50);
