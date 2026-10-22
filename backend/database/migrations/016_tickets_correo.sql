-- Envío de las entradas por correo (Nodemailer) con un link de descarga ÚNICO por ticket.
--
-- token_descarga  secreto propio de cada ticket: /api/publico/tickets/:token/descargar devuelve SOLO esa entrada
--                 (imagen con su QR). Así el comprador puede reenviar una entrada sin exponer las demás de la
--                 compra (el token de la venta, /entrada/:token, las muestra todas). Se genera al enviar el correo
--                 o al pedir los links, también para tickets anteriores a esta migración.
-- email_status    NULL = todavía no corresponde (venta sin confirmar o anterior a esta función)
--                 pending = enviando · sent = enviado · failed = falló (ver email_error): se puede reenviar
-- email_sent_at   cuándo se envió (o se intentó por última vez)
-- Compatible con producción: columnas NULL, no se tocan las filas existentes.
ALTER TABLE tickets
  ADD COLUMN token_descarga CHAR(40) NULL COMMENT 'link de descarga propio del ticket',
  ADD COLUMN email_status ENUM('pending','sent','failed') NULL COMMENT 'estado del correo con la entrada',
  ADD COLUMN email_sent_at DATETIME NULL,
  ADD COLUMN email_error VARCHAR(255) NULL,
  ADD UNIQUE INDEX uq_ticket_token_descarga (token_descarga);
