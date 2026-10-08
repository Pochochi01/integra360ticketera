const crypto = require('crypto');

/**
 * Cliente mínimo de la API REST de MercadoPago (Checkout Pro).
 * Recibe siempre las credenciales explícitamente: cada tenant cobra con su cuenta y la plataforma con la suya.
 * MERCADOPAGO_API_URL permite apuntar a un mock en pruebas.
 */
const API = () => (process.env.MERCADOPAGO_API_URL || 'https://api.mercadopago.com').replace(/\/$/, '');

class MercadoPagoError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const llamar = async (accessToken, metodo, ruta, body, extraHeaders = {}) => {
  const res = await fetch(`${API()}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  const data = texto ? JSON.parse(texto) : {};
  if (!res.ok) throw new MercadoPagoError(res.status, data.message || data.error || `MercadoPago respondió ${res.status}`);
  return data;
};

/** Verifica un access token y devuelve los datos de la cuenta (id = collector_id). */
const verificarCredenciales = (accessToken) => llamar(accessToken, 'GET', '/users/me');

/**
 * Crea una preferencia de Checkout Pro.
 * external_reference identifica qué se cobra ("venta:12:pago:34" / "suscripcion:3:pago:40").
 */
const crearPreferencia = (cred, { titulo, items, externalReference, notificationUrl, backUrls, payer }) =>
  llamar(
    cred.access_token,
    'POST',
    '/checkout/preferences',
    {
      items: items.map((i) => ({ title: i.title, quantity: i.quantity, unit_price: Number(i.unit_price), currency_id: 'ARS' })),
      external_reference: externalReference,
      notification_url: notificationUrl,
      back_urls: backUrls,
      auto_return: 'approved',
      payer,
      statement_descriptor: titulo?.slice(0, 22),
      metadata: { external_reference: externalReference },
    },
    { 'X-Idempotency-Key': externalReference }
  );

const obtenerPago = (cred, paymentId) => llamar(cred.access_token, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`);

/** Reembolso total de un pago aprobado. */
const reembolsar = (cred, paymentId) =>
  llamar(cred.access_token, 'POST', `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {}, {
    'X-Idempotency-Key': `refund-${paymentId}`,
  });

/**
 * Valida la firma x-signature de un webhook (si el tenant configuró su "clave secreta").
 * manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"  →  HMAC-SHA256 hex == v1
 */
const firmaValida = (secret, headers, dataId) => {
  if (!secret) return true;
  const firma = headers['x-signature'] || '';
  const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${headers['x-request-id'] || ''};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return esperado.length === partes.v1.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
};

/** Traduce el estado de un pago de MercadoPago al de la tabla pagos. */
const ESTADOS = { approved: 'aprobado', authorized: 'pendiente', in_process: 'pendiente', pending: 'pendiente', in_mediation: 'pendiente', rejected: 'rechazado', cancelled: 'cancelado', refunded: 'reembolsado', charged_back: 'reembolsado' };
const mapearEstado = (status) => ESTADOS[status] || 'pendiente';

module.exports = { verificarCredenciales, crearPreferencia, obtenerPago, reembolsar, firmaValida, mapearEstado, MercadoPagoError };
