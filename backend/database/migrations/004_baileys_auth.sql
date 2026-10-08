-- 004 · Sesión de WhatsApp (Baileys) persistida en MySQL en lugar de archivos.
-- Una fila por credencial / clave Signal. `valor` = JSON (BufferJSON) cifrado con AES-256-GCM (CREDENTIALS_KEY).
CREATE TABLE baileys_auth (
  id_tenant INT NOT NULL,
  categoria VARCHAR(40) NOT NULL COMMENT "'creds' o tipo de clave Signal: session, pre-key, sender-key, app-state-sync-key, lid-mapping…",
  clave VARCHAR(255) NOT NULL COMMENT "id de la clave ('creds' para las credenciales)",
  valor MEDIUMTEXT NOT NULL,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_tenant, categoria, clave),
  CONSTRAINT fk_baileys_auth_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Diagnóstico de la sesión (errores de descifrado y regeneraciones)
ALTER TABLE chatbot_integrations
  ADD COLUMN errores_descifrado INT NOT NULL DEFAULT 0 AFTER ultimo_error,
  ADD COLUMN regeneraciones INT NOT NULL DEFAULT 0 AFTER errores_descifrado,
  ADD COLUMN conectado_en DATETIME NULL AFTER regeneraciones;
