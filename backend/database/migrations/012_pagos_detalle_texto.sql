-- pagos.detalle guarda los links de Checkout Pro ({ init_point, sandbox_init_point }). Las URLs reales de
-- MercadoPago son largas y juntas superan los 255 caracteres ("Data too long for column 'detalle'"):
-- pasa a TEXT. También se amplía preference_id (MercadoPago no documenta un largo máximo).
ALTER TABLE pagos
  MODIFY detalle TEXT NULL,
  MODIFY preference_id VARCHAR(120) NULL COMMENT 'MercadoPago: preferencia de Checkout Pro';

-- id_externo de WhatsApp (Meta: "wamid.…") puede superar 80 caracteres
ALTER TABLE mensajes_whatsapp MODIFY id_externo VARCHAR(255) NULL;
