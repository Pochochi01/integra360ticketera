const { MercadoPago } = require('../models/Integracion');
const Venta = require('../models/Venta');
const chatbot = require('../services/chatbot');
const { AppError } = require('../utils/errors');

/**
 * Selecciona dinámicamente las credenciales de MercadoPago y las deja en req.mercadopago.
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

    const cred = await MercadoPago.obtener(ambito);
    if (!cred || !cred.activo) {
      throw new AppError(409, ambito === 0 ? 'La plataforma no tiene MercadoPago configurado' : 'El complejo no tiene MercadoPago configurado');
    }
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
