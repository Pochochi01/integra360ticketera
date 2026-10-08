-- =====================================================================================
-- 003 · Normalización a 3FN + MercadoPago (tenant / plataforma) + suscripciones + chatbot
--       + imagen de evento.  Migra los datos existentes antes de eliminar columnas.
--
-- Dependencias eliminadas:
--   usuarios.id_tenant          → pertenencia a un complejo: tablas administradores / vendedores
--   vendedores.nombre/apellido/dni/whatsapp → datos de la persona: sólo en usuarios
--   tenants.config (JSON)       → columnas atómicas (1FN)
--   asientos.id_evento          → se deduce de id_tipo (id_tipo → id_evento)
--   tickets.id_tenant, tickets.asiento → se deducen de la venta/evento y del asiento
--   ventas.id_tenant            → se deduce de id_evento
--   ventas.id_link              → id_link → id_vendedor (transitiva): pasa a ventas_link
--   ventas.referencia_pago      → hechos del cobro: tabla pagos
--   ventas.whatsapp_enviado_en  → se deduce de mensajes_whatsapp
-- =====================================================================================

-- ---------- Usuarios: persona + pertenencia ----------
ALTER TABLE usuarios ADD COLUMN apellido VARCHAR(80) NULL AFTER nombre;

-- Los datos personales del vendedor pasan a su usuario
UPDATE usuarios u JOIN vendedores v ON v.id_usuario = u.id_usuario
   SET u.nombre = v.nombre, u.apellido = v.apellido, u.dni = v.dni, u.whatsapp = v.whatsapp;

-- El DNI deja de ser único global: una persona puede tener cuentas de staff en distintos complejos.
ALTER TABLE usuarios DROP INDEX dni, ADD INDEX idx_usuario_dni (dni), ADD INDEX idx_usuario_whatsapp (whatsapp);

CREATE TABLE administradores (
  id_usuario INT PRIMARY KEY,
  id_tenant INT NOT NULL,
  CONSTRAINT fk_admin_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  CONSTRAINT fk_admin_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant)
) ENGINE=InnoDB;
INSERT INTO administradores (id_usuario, id_tenant)
SELECT id_usuario, id_tenant FROM usuarios WHERE rol = 'admin' AND id_tenant IS NOT NULL;

ALTER TABLE usuarios DROP FOREIGN KEY fk_usuario_tenant;
ALTER TABLE usuarios DROP COLUMN id_tenant;

ALTER TABLE vendedores
  DROP INDEX uq_vendedor_dni,
  DROP INDEX uq_vendedor_whatsapp,
  DROP COLUMN nombre,
  DROP COLUMN apellido,
  DROP COLUMN dni,
  DROP COLUMN whatsapp,
  ADD INDEX idx_vendedor_tenant (id_tenant, estado);

-- ---------- Tenants: configuración atómica ----------
ALTER TABLE tenants
  ADD COLUMN mensaje_whatsapp TEXT NULL,
  ADD COLUMN color_primario CHAR(7) NULL,
  ADD COLUMN logo_url VARCHAR(255) NULL;
UPDATE tenants SET
  mensaje_whatsapp = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.mensaje_whatsapp')), 'null'),
  color_primario  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.color_primario')), 'null'),
  logo_url        = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.logo_url')), 'null')
 WHERE config IS NOT NULL;
ALTER TABLE tenants DROP COLUMN config;

-- ---------- Eventos: imagen ----------
ALTER TABLE eventos ADD COLUMN imagen_evento VARCHAR(255) NULL COMMENT 'ruta relativa en /uploads' AFTER descripcion;

-- ---------- Asientos: el evento se obtiene del tipo ----------
DELETE a FROM asientos a LEFT JOIN tickets t ON t.id_asiento = a.id_asiento WHERE a.id_tipo IS NULL AND t.id_ticket IS NULL;
ALTER TABLE asientos DROP FOREIGN KEY fk_asiento_tipo;
ALTER TABLE asientos DROP FOREIGN KEY fk_asiento_evento;
ALTER TABLE asientos
  DROP INDEX uq_asiento,
  DROP COLUMN id_evento,
  MODIFY id_tipo INT NOT NULL,
  ADD UNIQUE KEY uq_asiento (id_tipo, sector, fila, numero),
  ADD CONSTRAINT fk_asiento_tipo FOREIGN KEY (id_tipo) REFERENCES tipos_ticket(id_tipo) ON DELETE CASCADE;

-- ---------- Tickets ----------
ALTER TABLE tickets DROP FOREIGN KEY fk_ticket_tenant;
ALTER TABLE tickets DROP INDEX idx_ticket_tenant, DROP COLUMN id_tenant, DROP COLUMN asiento;

-- ---------- Ventas ----------
CREATE TABLE ventas_link (
  id_venta INT PRIMARY KEY,
  id_link INT NOT NULL,
  CONSTRAINT fk_vl_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
  CONSTRAINT fk_vl_link FOREIGN KEY (id_link) REFERENCES links_venta(id_link),
  INDEX idx_vl_link (id_link)
) ENGINE=InnoDB;
INSERT INTO ventas_link (id_venta, id_link) SELECT id_venta, id_link FROM ventas WHERE id_link IS NOT NULL;

-- Pagos: un registro por intento de cobro (venta o suscripción)
CREATE TABLE pagos (
  id_pago INT AUTO_INCREMENT PRIMARY KEY,
  id_venta INT NULL,
  id_suscripcion INT NULL,
  proveedor ENUM('mercadopago','transferencia','simulado','cortesia') NOT NULL,
  estado ENUM('pendiente','aprobado','rechazado','cancelado','reembolsado') NOT NULL DEFAULT 'pendiente',
  monto DECIMAL(12,2) NOT NULL,
  preference_id VARCHAR(80) NULL COMMENT 'MercadoPago: preferencia de Checkout Pro',
  referencia_externa VARCHAR(80) NULL COMMENT 'MercadoPago payment_id / referencia de transferencia',
  detalle VARCHAR(255) NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pago_externo (proveedor, referencia_externa),
  INDEX idx_pago_venta (id_venta),
  INDEX idx_pago_suscripcion (id_suscripcion),
  CONSTRAINT fk_pago_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
  CONSTRAINT chk_pago_origen CHECK ((id_venta IS NULL) <> (id_suscripcion IS NULL))
) ENGINE=InnoDB;

INSERT INTO pagos (id_venta, proveedor, estado, monto, referencia_externa)
SELECT id_venta,
       CASE metodo_pago WHEN 'transferencia' THEN 'transferencia' WHEN 'cortesia' THEN 'cortesia' ELSE 'simulado' END,
       CASE estado WHEN 'pagado' THEN 'aprobado' WHEN 'reembolsado' THEN 'reembolsado' WHEN 'cancelado' THEN 'cancelado' ELSE 'pendiente' END,
       monto_total, referencia_pago
  FROM ventas WHERE referencia_pago IS NOT NULL OR estado IN ('pagado','reembolsado');

ALTER TABLE ventas DROP FOREIGN KEY fk_venta_tenant;
ALTER TABLE ventas DROP FOREIGN KEY fk_venta_link;
ALTER TABLE ventas
  DROP INDEX idx_venta_tenant_vendedor,
  DROP COLUMN id_tenant,
  DROP COLUMN id_link,
  DROP COLUMN referencia_pago,
  DROP COLUMN whatsapp_enviado_en,
  MODIFY metodo_pago ENUM('mercadopago','transferencia','tarjeta','billetera','cortesia') NOT NULL,
  ADD INDEX idx_venta_vendedor (id_vendedor, estado);

-- ---------- Mensajes: tipo y link enviado por vendedores ----------
ALTER TABLE mensajes_whatsapp
  ADD COLUMN tipo ENUM('entradas','link_venta','prueba') NOT NULL DEFAULT 'entradas' AFTER id_tenant,
  ADD COLUMN id_link INT NULL AFTER id_venta,
  ADD CONSTRAINT fk_msg_link FOREIGN KEY (id_link) REFERENCES links_venta(id_link) ON DELETE SET NULL;

-- ---------- Integraciones de MercadoPago ----------
-- id_tenant NULL = cuenta de la plataforma (superadmin, cobra suscripciones).
-- Los secretos se guardan cifrados (AES-256-GCM) por la aplicación.
CREATE TABLE mercadopago_integrations (
  id_integracion INT AUTO_INCREMENT PRIMARY KEY,
  id_tenant INT NULL,
  access_token TEXT NOT NULL COMMENT 'cifrado',
  public_key VARCHAR(120) NOT NULL,
  collector_id VARCHAR(40) NULL,
  webhook_secret TEXT NULL COMMENT 'cifrado',
  modo ENUM('prueba','produccion') NOT NULL DEFAULT 'prueba',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ambito INT AS (IFNULL(id_tenant, 0)) STORED COMMENT '0 = plataforma',
  UNIQUE KEY uq_mp_ambito (ambito),
  CONSTRAINT fk_mp_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant)
) ENGINE=InnoDB;

-- ---------- Integraciones de chatbot (gestionadas sólo por el superadmin) ----------
CREATE TABLE chatbot_integrations (
  id_tenant INT PRIMARY KEY,
  provider ENUM('meta','baileys') NOT NULL,
  credentials TEXT NULL COMMENT 'JSON cifrado: meta {phone_number_id, access_token, template?}; baileys: sesión en disco',
  estado ENUM('desconectado','esperando_qr','conectado','error') NOT NULL DEFAULT 'desconectado',
  ultimo_error VARCHAR(255) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chatbot_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Suscripciones de los tenants a la plataforma ----------
CREATE TABLE planes (
  id_plan INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  descripcion VARCHAR(255) NULL,
  precio_mensual DECIMAL(12,2) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE suscripciones (
  id_suscripcion INT AUTO_INCREMENT PRIMARY KEY,
  id_tenant INT NOT NULL UNIQUE,
  id_plan INT NOT NULL,
  estado ENUM('pendiente','activa','vencida','cancelada') NOT NULL DEFAULT 'pendiente',
  vence_el DATE NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sus_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant) ON DELETE CASCADE,
  CONSTRAINT fk_sus_plan FOREIGN KEY (id_plan) REFERENCES planes(id_plan)
) ENGINE=InnoDB;

ALTER TABLE pagos ADD CONSTRAINT fk_pago_suscripcion FOREIGN KEY (id_suscripcion) REFERENCES suscripciones(id_suscripcion);
