-- Integra360 Ticketera - multi-inquilino, vendedores / puntos de venta y WhatsApp

CREATE TABLE IF NOT EXISTS tenants (
  id_tenant INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE COMMENT 'subdominio / identificador publico',
  email_contacto VARCHAR(160) NULL,
  telefono VARCHAR(30) NULL,
  direccion VARCHAR(200) NULL,
  config JSON NULL COMMENT 'pais_telefono, mensaje_whatsapp, color, etc.',
  estado ENUM('activo','suspendido') NOT NULL DEFAULT 'activo',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Si ya había datos (instalación previa), pasan a un tenant por defecto
INSERT INTO tenants (id_tenant, nombre, slug)
SELECT 1, 'Complejo por defecto', 'default' FROM DUAL
 WHERE EXISTS (SELECT 1 FROM eventos) OR EXISTS (SELECT 1 FROM usuarios WHERE rol = 'admin');

-- Usuarios: roles nuevos, WhatsApp y tenant (NULL para compradores y superadmin)
ALTER TABLE usuarios
  ADD COLUMN id_tenant INT NULL AFTER id_usuario,
  ADD COLUMN whatsapp VARCHAR(20) NULL AFTER dni,
  MODIFY dni VARCHAR(20) NULL,
  MODIFY rol ENUM('superadmin','admin','vendedor','comprador','usuario') NOT NULL DEFAULT 'comprador';
UPDATE usuarios SET rol = 'comprador' WHERE rol = 'usuario';
UPDATE usuarios SET id_tenant = 1 WHERE rol = 'admin';
ALTER TABLE usuarios
  MODIFY rol ENUM('superadmin','admin','vendedor','comprador') NOT NULL DEFAULT 'comprador',
  ADD CONSTRAINT fk_usuario_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant);

-- Eventos por tenant
ALTER TABLE eventos
  ADD COLUMN id_tenant INT NOT NULL DEFAULT 1 AFTER id_evento,
  ADD INDEX idx_evento_tenant (id_tenant, estado, fecha),
  ADD CONSTRAINT fk_evento_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant);
ALTER TABLE eventos ALTER COLUMN id_tenant DROP DEFAULT;

-- Vendedores = puntos de venta. Cada uno tiene una cuenta de usuario (rol vendedor) para su panel.
CREATE TABLE IF NOT EXISTS vendedores (
  id_vendedor INT AUTO_INCREMENT PRIMARY KEY,
  id_tenant INT NOT NULL,
  id_usuario INT NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  dni VARCHAR(20) NOT NULL,
  whatsapp VARCHAR(20) NOT NULL COMMENT 'E.164',
  estado ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendedor_dni (id_tenant, dni),
  UNIQUE KEY uq_vendedor_whatsapp (id_tenant, whatsapp),
  CONSTRAINT fk_vendedor_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant),
  CONSTRAINT fk_vendedor_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) ENGINE=InnoDB;

-- Links de venta únicos por vendedor (generales o de un evento puntual)
CREATE TABLE IF NOT EXISTS links_venta (
  id_link INT AUTO_INCREMENT PRIMARY KEY,
  id_vendedor INT NOT NULL,
  id_evento INT NULL COMMENT 'NULL = link general a todos los eventos del tenant',
  codigo VARCHAR(16) NOT NULL UNIQUE,
  descripcion VARCHAR(120) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  visitas INT NOT NULL DEFAULT 0,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_link_vendedor FOREIGN KEY (id_vendedor) REFERENCES vendedores(id_vendedor) ON DELETE CASCADE,
  CONSTRAINT fk_link_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Ventas: tenant, vendedor/link de origen, WhatsApp de contacto y token del link público de entradas
ALTER TABLE ventas
  ADD COLUMN id_tenant INT NULL AFTER id_venta,
  ADD COLUMN id_vendedor INT NULL AFTER id_usuario,
  ADD COLUMN id_link INT NULL AFTER id_vendedor,
  ADD COLUMN whatsapp_contacto VARCHAR(20) NULL,
  ADD COLUMN token_acceso CHAR(40) NULL,
  ADD COLUMN whatsapp_enviado_en DATETIME NULL;
UPDATE ventas v JOIN eventos e ON e.id_evento = v.id_evento
   SET v.id_tenant = e.id_tenant, v.token_acceso = LEFT(SHA2(CONCAT(v.id_venta, UUID(), RAND()), 256), 40);
ALTER TABLE ventas
  MODIFY id_tenant INT NOT NULL,
  MODIFY token_acceso CHAR(40) NOT NULL,
  ADD UNIQUE KEY uq_venta_token (token_acceso),
  ADD INDEX idx_venta_tenant_vendedor (id_tenant, id_vendedor, estado),
  ADD CONSTRAINT fk_venta_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant),
  ADD CONSTRAINT fk_venta_vendedor FOREIGN KEY (id_vendedor) REFERENCES vendedores(id_vendedor),
  ADD CONSTRAINT fk_venta_link FOREIGN KEY (id_link) REFERENCES links_venta(id_link) ON DELETE SET NULL;

-- Tickets por tenant
ALTER TABLE tickets ADD COLUMN id_tenant INT NULL AFTER id_ticket;
UPDATE tickets t JOIN ventas v ON v.id_venta = t.id_venta SET t.id_tenant = v.id_tenant;
ALTER TABLE tickets
  MODIFY id_tenant INT NOT NULL,
  ADD INDEX idx_ticket_tenant (id_tenant, estado),
  ADD CONSTRAINT fk_ticket_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant);

-- Registro de mensajes de WhatsApp enviados
CREATE TABLE IF NOT EXISTS mensajes_whatsapp (
  id_mensaje INT AUTO_INCREMENT PRIMARY KEY,
  id_tenant INT NOT NULL,
  id_venta INT NULL,
  destino VARCHAR(20) NOT NULL,
  cuerpo TEXT NOT NULL,
  proveedor VARCHAR(20) NOT NULL,
  estado ENUM('enviado','error') NOT NULL,
  id_externo VARCHAR(80) NULL,
  error VARCHAR(255) NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant),
  CONSTRAINT fk_msg_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta)
) ENGINE=InnoDB;
