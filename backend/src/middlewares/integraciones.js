const { credencialesValidas } = require('../services/mercadopagoTokens');
const Venta = require('../models/Venta');
const chatbot = require('../services/chatbot');
const { AppError } = require('../utils/errors');

/**
 * Inyecta en req.mercadopago un access token de MercadoPago VÁLIDO (renovado con el refresh token si
 * estaba por vencer) de la cuenta que corresponde. req.ambitoMercadoPago queda con el ámbito.
 *  - 'sesion':     tenant del admin autenticado (req.tenant)
 *  - 'venta':      tenant dueño de la venta :id (el comprador paga al complejo, no a la plataforma)
 *  - 'plataforma': cuenta del superadmin (cobro de suscripciones)
 *  - 'webhook':    :ambito de la URL del webhook ('plataforma' o id_tenant)
 */
const seleccionarMercadoPago = (origen, { soloSiLaVentaUsaMercadoPago = false } = {}) => async (req, _res, next) => {
  try {
    let ambito;
    if (origen === 'sesion') ambito = req.tenant.id_tenant;
    else if (origen === 'plataforma') ambito = 0;
    else if (origen === 'webhook') ambito = req.params.ambito === 'plataforma' ? 0 : Number(req.params.ambito);
    else if (origen === 'venta') {
      const venta = await Venta.findById(req.params.id);
      if (!venta) throw new AppError(404, 'Venta no encontrada');
      req.ventaCargada = venta;
      // Ventas por transferencia / simuladas no necesitan credenciales
      if (soloSiLaVentaUsaMercadoPago && venta.metodo_pago !== 'mercadopago') return next();
      ambito = venta.id_tenant;
    }
    if (!Number.isInteger(ambito)) throw new AppError(400, 'Ámbito de MercadoPago inválido');

    // Webhooks: sólo se identifica el ámbito; el pago se consulta después con conCredenciales
    if (origen === 'webhook') {
      req.ambitoMercadoPago = ambito;
      return next();
    }
    const cred = await credencialesValidas(ambito);
    if (!cred.activo) throw new AppError(409, 'El complejo pausó los cobros con MercadoPago');
    req.mercadopago = cred;
    req.ambitoMercadoPago = ambito;
    next();
  } catch (err) {
    next(err);
  }
};

/** Exige que el complejo de la sesión tenga un chatbot operativo; deja en req.chatbot su estado. */
const requiereChatbot = async (req, _res, next) => {
  try {
    const estado = await chatbot.disponible(req.tenant.id_tenant);
    if (!estado.disponible) throw new AppError(409, `El WhatsApp del complejo no está disponible (${estado.provider}: ${estado.estado}). Contactá al administrador de la plataforma.`);
    req.chatbot = estado;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { seleccionarMercadoPago, requiereChatbot };
