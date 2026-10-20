-- MercadoPago devuelve en "scope" la lista completa de permisos concedidos, que puede superar los 160
-- caracteres ("Data too long for column 'scope'"): pasa a TEXT. También se amplían por las dudas
-- nickname y public_key, que MercadoPago tampoco documenta con un largo máximo.
ALTER TABLE mercadopago_tokens
  MODIFY scope TEXT NULL,
  MODIFY nickname VARCHAR(160) NULL,
  MODIFY public_key VARCHAR(255) NULL;
