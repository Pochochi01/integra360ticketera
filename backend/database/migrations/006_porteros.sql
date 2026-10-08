-- Rol "portero": personal de puerta de cada complejo, con acceso sólo a la Portería.
--
-- Igual que administradores / vendedores (3FN):
--   usuarios   → persona y credenciales (nombre, password_hash, rol = 'portero')
--   porteros   → pertenencia al complejo (tenants = complejos), nombre de usuario para ingresar y estado
-- Así hay un único camino de login y de hash de contraseñas para todos los roles.

ALTER TABLE usuarios
  MODIFY rol ENUM('superadmin','admin','vendedor','comprador','portero') NOT NULL DEFAULT 'comprador',
  -- Los porteros ingresan con un usuario generado (no tienen email). UNIQUE admite varios NULL.
  MODIFY email VARCHAR(160) NULL;

CREATE TABLE porteros (
  id_portero INT AUTO_INCREMENT PRIMARY KEY,
  id_tenant INT NOT NULL COMMENT 'complejo al que pertenece',
  id_usuario INT NOT NULL UNIQUE,
  usuario VARCHAR(60) NOT NULL UNIQUE COMMENT 'nombre de usuario generado, ej. norte.juan',
  estado ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_portero_tenant (id_tenant, estado),
  CONSTRAINT fk_portero_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant),
  CONSTRAINT fk_portero_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Inscripciones a eventos: cada ticket emitido es una inscripción de su titular.
-- Vista (no tabla) para no duplicar datos: el estado vive en tickets y se actualiza al validar.
CREATE OR REPLACE VIEW eventos_inscripciones AS
SELECT t.id_ticket AS id_inscripcion,
       e.id_tenant,
       e.id_evento,
       e.nombre AS evento,
       e.fecha AS fecha_evento,
       t.id_usuario,
       CONCAT_WS(' ', u.nombre, u.apellido) AS titular,
       tt.nombre_tipo,
       t.codigo_qr,
       t.estado,
       t.fecha_uso AS fecha_ingreso
  FROM tickets t
  JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo
  JOIN eventos e ON e.id_evento = tt.id_evento
  JOIN usuarios u ON u.id_usuario = t.id_usuario;
