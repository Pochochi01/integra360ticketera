const { procesarPagoMercadoPago } = require('../services/pagosService');
const mp = require('../services/mercadopagoService');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { asyncHandler } = require('../utils/errors');

/**
 * Webhooks de MercadoPago. La firma se valida con la clave secreta de la aplicación (MP_WEBHOOK_SECRET:
 * es única, porque todas las cuentas se vinculan a la misma app por OAuth).
 * Nunca confía en el cuerpo: vuelve a consultar el pago con el token de la cuenta que cobró, y
 * procesarPagoMercadoPago verifica que el cobrador y la referencia correspondan al complejo de la venta.
 * Responde 200 a lo que no es un pago (merchant_order, etc.) y 500 ante errores para que MercadoPago reintente.
 *
 *  POST /api/pagos/webhook                        → URL única (la de «Webhooks» de la aplicación):
 *       el complejo sale de body.user_id (la cuenta de MercadoPago que recibió el pago)
 *  POST /api/pagos/webhook/mercadopago/:ambito    → la notification_url de cada preferencia
 *       (ambito = id_tenant | "plataforma")
 */
const datosDeLaNotificacion = (req) => {
  const tipo = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
  const dataId = req.query['data.id'] || req.body?.data?.id || (tipo === 'payment' ? req.query.id : null);
  return { tipo, dataId };
};

const procesar = async (req, res, ambito) => {
  const { tipo, dataId } = datosDeLaNotificacion(req);
  if (tipo !== 'payment' || !dataId) return res.status(200).json({ ignorado: true });
  if (!mp.firmaValida(process.env.MP_WEBHOOK_SECRET, req.headers, dataId)) return res.status(401).json({ error: 'Firma inválida' });
  if (ambito === null) return res.status(200).json({ ignorado: 'La cuenta de MercadoPago no está vinculada a ningún complejo' });
  try {
    res.status(200).json(await procesarPagoMercadoPago(ambito, String(dataId)));
  } catch (err) {
    // Pago inexistente en esa cuenta (ej. «Simular notificación» de MercadoPago): no tiene sentido reintentar
    if (err.status === 404) return res.status(200).json({ ignorado: 'El pago no existe en la cuenta de MercadoPago' });
    console.error('[mercadopago] webhook', err.message);
    res.status(500).json({ error: 'No se pudo procesar la notificación' });
  }
};

/** URL única: identifica el complejo por la cuenta cobradora (user_id). */
exports.webhook = asyncHandler(async (req, res) => {
  const userId = req.body?.user_id ?? req.query.user_id;
  const ambito = userId ? await MercadoPagoToken.ambitoDeCuenta(userId) : null;
  return procesar(req, res, ambito);
});

/** URL por ámbito (notification_url de la preferencia). req.ambitoMercadoPago lo carga el middleware. */
exports.webhookMercadoPago = asyncHandler(async (req, res) => procesar(req, res, req.ambitoMercadoPago));
