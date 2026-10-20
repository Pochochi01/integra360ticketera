const Tenant = require('../models/Tenant');
const { Chatbot } = require('../models/Integracion');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const mpOAuth = require('../services/mercadopagoOAuth');
const { conCredenciales } = require('../services/mercadopagoTokens');
const mp = require('../services/mercadopagoService');
const chatbot = require('../services/chatbot');
const { enviarPrueba } = require('../services/notificaciones');
const { normalizarWhatsapp } = require('../utils/whatsapp');
const { AppError, asyncHandler } = require('../utils/errors');

const backend = () => (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
const webhookUrl = (ambito) => `${backend()}/api/pagos/webhook/mercadopago/${ambito}`;

// ======================= MercadoPago (vinculado por OAuth) =======================
// La vinculación (botón «Conectar con MercadoPago») está en mercadopagoOAuthController.
// Acá: estado de la conexión, pausar cobros, probar y desvincular.

const verMercadoPago = async (ambito) => ({
  app_configurada: mpOAuth.configurada(),
  conexion: await MercadoPagoToken.publica(ambito),
  webhook_url: webhookUrl(ambito || 'plataforma'),
});

/** Prueba la conexión con un token válido (lo renueva si hace falta) y actualiza el correo vinculado. */
const probarMercadoPago = async (ambito) => {
  const cuenta = await conCredenciales(ambito, (cred) => mp.cuentaDelToken(cred.access_token));
  await MercadoPagoToken.actualizarCuenta(ambito, cuenta);
  return { ok: true, cuenta: { id: cuenta.id, nickname: cuenta.nickname, email: cuenta.email }, conexion: await MercadoPagoToken.publica(ambito) };
};

const pausarMercadoPago = async (ambito, body) => {
  if (typeof body.activo !== 'boolean') throw new AppError(400, 'Indique activo: true | false');
  if (!(await MercadoPagoToken.publica(ambito))) throw new AppError(404, 'No hay una cuenta de MercadoPago conectada');
  await MercadoPagoToken.setActivo(ambito, body.activo);
  return verMercadoPago(ambito);
};

// Admin del complejo: su propia cuenta (cobro de entradas)
exports.verMercadoPagoTenant = asyncHandler(async (req, res) => res.json(await verMercadoPago(req.tenant.id_tenant)));
exports.pausarMercadoPagoTenant = asyncHandler(async (req, res) => res.json(await pausarMercadoPago(req.tenant.id_tenant, req.body)));
exports.probarMercadoPagoTenant = asyncHandler(async (req, res) => res.json(await probarMercadoPago(req.tenant.id_tenant)));
exports.eliminarMercadoPagoTenant = asyncHandler(async (req, res) => {
  await MercadoPagoToken.eliminar(req.tenant.id_tenant);
  res.status(204).end();
});

// Superadmin: cuenta de la plataforma (cobro de suscripciones)
exports.verMercadoPagoPlataforma = asyncHandler(async (_req, res) => res.json(await verMercadoPago(0)));
exports.probarMercadoPagoPlataforma = asyncHandler(async (_req, res) => res.json(await probarMercadoPago(0)));
exports.eliminarMercadoPagoPlataforma = asyncHandler(async (_req, res) => {
  await MercadoPagoToken.eliminar(0);
  res.status(204).end();
});

// ======================= Chatbot (sólo superadmin) =======================

const tenantExistente = async (id) => {
  const t = await Tenant.findById(id);
  if (!t) throw new AppError(404, 'Complejo no encontrado');
  return t;
};

const conEstadoVivo = async (idTenant, publica) => {
  if (!publica) return null;
  if (publica.provider === 'baileys') {
    const vivo = chatbot.baileys.estadoDe(idTenant);
    return { ...publica, estado: vivo.estado === 'desconectado' && publica.estado === 'error' ? 'error' : vivo.estado, qr: vivo.qr };
  }
  return publica;
};

exports.verChatbot = asyncHandler(async (req, res) => {
  await tenantExistente(req.params.idTenant);
  res.json(await conEstadoVivo(Number(req.params.idTenant), await Chatbot.publica(req.params.idTenant)));
});

/**
 * PUT /integraciones/chatbot/:idTenant { provider: 'meta'|'baileys', credentials?, activo? }
 * Meta: se verifican phone_number_id + token contra la Graph API antes de guardar.
 * Baileys: se guarda la elección; la vinculación se hace con /baileys/conectar (QR).
 */
exports.guardarChatbot = asyncHandler(async (req, res) => {
  const idTenant = Number(req.params.idTenant);
  await tenantExistente(idTenant);
  const { provider, credentials = {}, activo = true } = req.body;
  if (!['meta', 'baileys'].includes(provider)) throw new AppError(400, 'Proveedor inválido (meta o baileys)');

  const anterior = await Chatbot.obtener(idTenant);
  if (provider === 'meta') {
    const cred = {
      phone_number_id: String(credentials.phone_number_id || '').trim(),
      access_token: String(credentials.access_token || '').trim() || (anterior?.provider === 'meta' ? anterior.credentials.access_token : ''),
      template: String(credentials.template || '').trim() || null,
      idioma: String(credentials.idioma || 'es_AR').trim(),
    };
    if (!/^\d{5,20}$/.test(cred.phone_number_id)) throw new AppError(400, 'Phone number ID inválido (sólo números)');
    if (!cred.access_token) throw new AppError(400, 'El access token de Meta es obligatorio');
    if (cred.template && !/^[a-z0-9_]{1,512}$/.test(cred.template)) throw new AppError(400, 'Nombre de plantilla inválido (minúsculas, números y _)');
    try {
      await chatbot.meta.verificar(cred);
    } catch (e) {
      throw new AppError(400, `Meta rechazó las credenciales: ${e.message}`);
    }
    if (anterior?.provider === 'baileys') await chatbot.baileys.desconectar(idTenant, { logout: true });
    return res.json(await Chatbot.guardar(idTenant, { provider, credentials: cred, activo }));
  }
  const guardada = await Chatbot.guardar(idTenant, { provider, activo });
  res.json(await conEstadoVivo(idTenant, guardada));
});

exports.eliminarChatbot = asyncHandler(async (req, res) => {
  const idTenant = Number(req.params.idTenant);
  await chatbot.baileys.desconectar(idTenant, { logout: true }).catch(() => {});
  await Chatbot.eliminar(idTenant);
  res.status(204).end();
});

/** Inicia la vinculación de Baileys: el QR aparece en GET /baileys/estado. */
exports.conectarBaileys = asyncHandler(async (req, res) => {
  const idTenant = Number(req.params.idTenant);
  const integracion = await Chatbot.obtener(idTenant);
  if (integracion?.provider !== 'baileys') throw new AppError(409, 'El complejo no tiene Baileys como proveedor');
  await chatbot.baileys.conectar(idTenant);
  res.json(chatbot.baileys.estadoDe(idTenant));
});

exports.estadoBaileys = asyncHandler(async (req, res) => {
  const { estado, qr } = chatbot.baileys.estadoDe(Number(req.params.idTenant));
  res.json({ estado, qr });
});

exports.desconectarBaileys = asyncHandler(async (req, res) => {
  await chatbot.baileys.desconectar(Number(req.params.idTenant), { logout: req.body?.logout !== false });
  res.json({ estado: 'desconectado' });
});

/** Envía un mensaje de prueba por el chatbot del complejo. */
exports.probarChatbot = asyncHandler(async (req, res) => {
  const idTenant = Number(req.params.idTenant);
  await tenantExistente(idTenant);
  const destino = normalizarWhatsapp(req.body.whatsapp, process.env.WHATSAPP_PAIS_DEFECTO || 'AR');
  if (!destino) throw new AppError(400, 'Número de WhatsApp inválido');
  const r = await enviarPrueba(idTenant, destino);
  if (!r.enviado) throw new AppError(502, `No se pudo enviar: ${r.motivo}`);
  res.json({ mensaje: `Mensaje de prueba enviado a ${destino}`, provider: r.provider });
});

/** Estado de solo lectura para el admin del complejo (no puede modificarlo). */
exports.estadoChatbotTenant = asyncHandler(async (req, res) => res.json(await chatbot.disponible(req.tenant.id_tenant)));
