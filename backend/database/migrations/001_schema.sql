-- Integra360 Ticketera - esquema inicial
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  dni VARCHAR(20) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('admin','usuario') NOT NULL DEFAULT 'usuario',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS eventos (
  id_evento INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  descripcion TEXT,
  fecha DATETIME NOT NULL,
  lugar VARCHAR(200) NOT NULL,
  limite_por_persona INT NULL COMMENT 'NULL = sin limite',
  tiene_seating TINYINT(1) NOT NULL DEFAULT 0,
  estado ENUM('borrador','publicado','agotado','cancelado','finalizado') NOT NULL DEFAULT 'publicado',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tipos_ticket (
  id_tipo INT AUTO_INCREMENT PRIMARY KEY,
  id_evento INT NOT NULL,
  nombre_tipo VARCHAR(80) NOT NULL,
  precio DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock_total INT NOT NULL,
  stock_disponible INT NOT NULL,
  condiciones VARCHAR(255) NULL,
  venta_desde DATETIME NULL,
  venta_hasta DATETIME NULL COMMENT 'ej. fin de Early Bird',
  solo_admin TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'invitaciones / bloques corporativos',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_tipo_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento) ON DELETE CASCADE,
  CONSTRAINT chk_stock CHECK (stock_disponible >= 0 AND stock_disponible <= stock_total)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS asientos (
  id_asiento INT AUTO_INCREMENT PRIMARY KEY,
  id_evento INT NOT NULL,
  id_tipo INT NULL,
  sector VARCHAR(40) NOT NULL,
  fila VARCHAR(10) NOT NULL,
  numero INT NOT NULL,
  UNIQUE KEY uq_asiento (id_evento, sector, fila, numero),
  CONSTRAINT fk_asiento_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento) ON DELETE CASCADE,
  CONSTRAINT fk_asiento_tipo FOREIGN KEY (id_tipo) REFERENCES tipos_ticket(id_tipo) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ventas (
  id_venta INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  id_evento INT NOT NULL,
  fecha_venta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  monto_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado ENUM('pendiente','pagado','cancelado','reembolsado') NOT NULL DEFAULT 'pendiente',
  metodo_pago ENUM('tarjeta','transferencia','billetera','cortesia') NOT NULL,
  tipo_venta ENUM('normal','corporativa','invitacion') NOT NULL DEFAULT 'normal',
  referencia_pago VARCHAR(120) NULL,
  empresa VARCHAR(160) NULL,
  CONSTRAINT fk_venta_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
  CONSTRAINT fk_venta_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento),
  INDEX idx_venta_usuario_evento (id_usuario, id_evento, estado)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tickets (
  id_ticket INT AUTO_INCREMENT PRIMARY KEY,
  id_venta INT NOT NULL,
  id_tipo INT NOT NULL,
  id_usuario INT NOT NULL COMMENT 'titular actual (cambia al transferir)',
  codigo_qr VARCHAR(64) NOT NULL UNIQUE,
  estado ENUM('pendiente','valido','usado','cancelado','reembolsado') NOT NULL DEFAULT 'pendiente',
  asiento VARCHAR(40) NULL,
  id_asiento INT NULL,
  fecha_uso DATETIME NULL,
  -- un asiento solo puede estar ocupado por un ticket activo (evita duplicados)
  asiento_activo INT AS (IF(estado IN ('pendiente','valido','usado'), id_asiento, NULL)) STORED,
  UNIQUE KEY uq_asiento_activo (asiento_activo),
  CONSTRAINT fk_ticket_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
  CONSTRAINT fk_ticket_tipo FOREIGN KEY (id_tipo) REFERENCES tipos_ticket(id_tipo),
  CONSTRAINT fk_ticket_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
  CONSTRAINT fk_ticket_asiento FOREIGN KEY (id_asiento) REFERENCES asientos(id_asiento)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transferencias_ticket (
  id_transferencia INT AUTO_INCREMENT PRIMARY KEY,
  id_ticket INT NOT NULL,
  id_usuario_origen INT NOT NULL,
  id_usuario_destino INT NOT NULL,
  fecha_transferencia TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  codigo_qr_anterior VARCHAR(64) NOT NULL,
  CONSTRAINT fk_tr_ticket FOREIGN KEY (id_ticket) REFERENCES tickets(id_ticket),
  CONSTRAINT fk_tr_origen FOREIGN KEY (id_usuario_origen) REFERENCES usuarios(id_usuario),
  CONSTRAINT fk_tr_destino FOREIGN KEY (id_usuario_destino) REFERENCES usuarios(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lista_espera (
  id_espera INT AUTO_INCREMENT PRIMARY KEY,
  id_tipo INT NOT NULL,
  id_usuario INT NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  estado ENUM('esperando','notificado','cancelado') NOT NULL DEFAULT 'esperando',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_espera (id_tipo, id_usuario),
  CONSTRAINT fk_espera_tipo FOREIGN KEY (id_tipo) REFERENCES tipos_ticket(id_tipo) ON DELETE CASCADE,
  CONSTRAINT fk_espera_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accesos (
  id_acceso INT AUTO_INCREMENT PRIMARY KEY,
  codigo_leido VARCHAR(64) NOT NULL,
  id_ticket INT NULL,
  resultado ENUM('valido','usado','invalido') NOT NULL,
  id_validador INT NOT NULL,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
