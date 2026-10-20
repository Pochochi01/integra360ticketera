-- MercadoPago vía OAuth oficial (con refresh tokens).
--
-- Reemplaza a mercadopago_integrations, donde cada admin pegaba a mano un access token que vencía y
-- nunca se renovaba. Ahora cada cuenta se vincula con "Conectar con MercadoPago" y el sistema guarda
-- access_token + refresh_token (cifrados, AES-256-GCM) y los renueva solo.
--
--   tipo 'tenant' → cuenta de un complejo (cobra entradas),    id_tenant = complejo
--   tipo 'admin'  → cuenta de la plataforma (cobra suscripciones), id_tenant = NULL (fila única)
CREATE TABLE mercadopago_tokens (
  id_token INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('tenant','admin') NOT NULL,
  id_tenant INT NULL,
  access_token TEXT NOT NULL COMMENT 'cifrado',
  refresh_token TEXT NOT NULL COMMENT 'cifrado',
  expires_in INT NOT NULL COMMENT 'vida del access token en segundos, según MercadoPago',
  expira_en DATETIME NOT NULL COMMENT 'momento en que vence el access token',
  correo_vinculado VARCHAR(160) NULL,
  mp_user_id VARCHAR(40) NOT NULL COMMENT 'cuenta de MercadoPago (collector) que recibe los cobros',
  nickname VARCHAR(80) NULL,
  public_key VARCHAR(120) NULL,
  live_mode TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = credenciales de prueba',
  scope VARCHAR(160) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'el complejo puede pausar el cobro sin desvincular la cuenta',
  estado ENUM('conectado','requiere_reconexion') NOT NULL DEFAULT 'conectado',
  ultimo_error VARCHAR(255) NULL,
  conectado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  renovado_en DATETIME NULL,
  ambito INT AS (IFNULL(id_tenant, 0)) STORED COMMENT '0 = plataforma',
  UNIQUE KEY uq_mpt_ambito (ambito),
  INDEX idx_mpt_vencimiento (estado, expira_en),
  CONSTRAINT chk_mpt_tipo CHECK ((tipo = 'admin' AND id_tenant IS NULL) OR (tipo = 'tenant' AND id_tenant IS NOT NULL)),
  CONSTRAINT fk_mpt_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant)
) ENGINE=InnoDB;

-- Intentos de conexión en curso: el "state" de OAuth es de un solo uso y vence a los 10 minutos.
-- Guarda también el code_verifier de PKCE (nunca viaja al navegador).
CREATE TABLE mercadopago_oauth_estados (
  state CHAR(43) PRIMARY KEY,
  ambito INT NOT NULL COMMENT '0 = plataforma, si no id_tenant',
  id_usuario INT NOT NULL COMMENT 'quién inició la conexión',
  code_verifier TEXT NULL COMMENT 'cifrado (PKCE)',
  expira_en DATETIME NOT NULL,
  CONSTRAINT fk_mpo_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Los tokens pegados a mano no tienen refresh token: cada cuenta se vuelve a vincular por OAuth.
DROP TABLE mercadopago_integrations;
