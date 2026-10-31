const pool = require('../config/db');
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
  if (ambito === null) {
    await auditar({ paymentId: dataId, ambito: null, httpStatus: 200, resultado: 'Cuenta de MercadoPago no vinculada' });
    return res.status(200).json({ ignorado: 'La cuenta de MercadoPago no está vinculada a ningún complejo' });
  }
  try {
    const r = await procesarPagoMercadoPago(ambito, String(dataId));
    await auditar({ paymentId: dataId, ambito, idVenta: r.tipo === 'venta' ? r.id : null, estado: r.estado, httpStatus: 200, resultado: r.ignorado || r.motivo || (r.estado ? `Procesado: ${r.estado}` : null) });
    res.status(200).json(r);
  } catch (err) {
    // Pago inexistente en esa cuenta (ej. «Simular notificación» de MercadoPago): no tiene sentido reintentar
    if (err.status === 404) {
      await auditar({ paymentId: dataId, ambito, httpStatus: 200, resultado: 'El pago no existe en esa cuenta' });
      return res.status(200).json({ ignorado: 'El pago no existe en la cuenta de MercadoPago' });
    }
    console.error('[mercadopago] webhook', err.message);
    await auditar({ paymentId: dataId, ambito, httpStatus: 500, resultado: `Error (MercadoPago reintenta): ${err.message}` });
    res.status(500).json({ error: 'No se pudo procesar la notificación' });
  }
};

/**
 * Auditoría de cada notificación (mercadopago_notificaciones): qué llegó, cuándo y qué se hizo. Nunca rompe el
 * webhook: si no se puede guardar el registro, sólo se informa por consola.
 */
const auditar = ({ paymentId, ambito, idVenta = null, estado = null, httpStatus, resultado = null }) =>
  pool.query(
    'INSERT INTO mercadopago_notificaciones (payment_id, ambito, id_venta, estado, resultado, http_status) VALUES (?, ?, ?, ?, ?, ?)',
    [String(paymentId).slice(0, 40), ambito, idVenta, estado, resultado ? String(resultado).slice(0, 255) : null, httpStatus]
  ).catch((e) => console.warn('[mercadopago] no se pudo auditar la notificación', e.message));

/** URL única: identifica el complejo por la cuenta cobradora (user_id). */
exports.webhook = asyncHandler(async (req, res) => {
  const userId = req.body?.user_id ?? req.query.user_id;
  const ambito = userId ? await MercadoPagoToken.ambitoDeCuenta(userId) : null;
  return procesar(req, res, ambito);
});

/** URL por ámbito (notification_url de la preferencia). req.ambitoMercadoPago lo carga el middleware. */
exports.webhookMercadoPago = asyncHandler(async (req, res) => procesar(req, res, req.ambitoMercadoPago));
