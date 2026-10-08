const { procesarPagoMercadoPago } = require('../services/pagosService');
const mp = require('../services/mercadopagoService');
const { asyncHandler } = require('../utils/errors');

/**
 * POST /pagos/webhook/mercadopago/:ambito   (ambito = id_tenant | "plataforma")
 * Notificación de MercadoPago. req.mercadopago lo carga el middleware según el ámbito.
 * Nunca confía en el cuerpo: vuelve a consultar el pago con las credenciales de ese ámbito.
 * Responde 200 a lo que no es un pago (merchant_order, etc.) y 500 ante errores para que MercadoPago reintente.
 */
exports.webhookMercadoPago = asyncHandler(async (req, res) => {
  const tipo = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
  const dataId = req.query['data.id'] || req.body?.data?.id || (tipo === 'payment' ? req.query.id : null);
  if (tipo !== 'payment' || !dataId) return res.status(200).json({ ignorado: true });

  if (!mp.firmaValida(req.mercadopago.webhook_secret, req.headers, dataId)) {
    return res.status(401).json({ error: 'Firma inválida' });
  }
  try {
    const resultado = await procesarPagoMercadoPago(req.ambitoMercadoPago, String(dataId));
    res.status(200).json(resultado);
  } catch (err) {
    console.error('[mercadopago] webhook', err.message);
    res.status(500).json({ error: 'No se pudo procesar la notificación' });
  }
});
