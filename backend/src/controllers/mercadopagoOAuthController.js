const mpOAuth = require('../services/mercadopagoOAuth');
const { EstadoOAuth } = require('../models/MercadoPagoToken');
const { asyncHandler } = require('../utils/errors');

/**
 * Conexión de cuentas de MercadoPago por OAuth.
 *
 * GET /api/auth/mercadopago/connect             (admin del complejo)  → cuenta del complejo
 * GET /api/auth/mercadopago/connect/plataforma  (superadmin)          → cuenta de la plataforma
 *   Con JWT devuelven { url } y el frontend navega a esa URL: una redirección directa no
 *   llevaría el JWT (que vive en el navegador, no en una cookie). Con ?redirect=1 responden 302.
 *
 * GET /api/auth/mercadopago/callback?code&state  (público; lo llama MercadoPago)
 *   Canjea el código, guarda los tokens y vuelve al panel con ?mp=conectado | ?mp=error&mensaje=…
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const panelDe = (ambito) => (ambito === 0 ? '/super/plataforma' : '/admin/integraciones');

const responder = (req, res, url) => (req.query.redirect === '1' ? res.redirect(302, url) : res.json({ url }));

exports.conectarTenant = asyncHandler(async (req, res) =>
  responder(req, res, await mpOAuth.urlDeAutorizacion({ ambito: req.tenant.id_tenant, idUsuario: req.usuario.id_usuario })));

exports.conectarPlataforma = asyncHandler(async (req, res) =>
  responder(req, res, await mpOAuth.urlDeAutorizacion({ ambito: 0, idUsuario: req.usuario.id_usuario })));

exports.callback = async (req, res) => {
  const volver = (ambito, params) => {
    const url = new URL(`${frontend()}${panelDe(ambito)}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    res.redirect(302, url.toString());
  };

  // El titular canceló o MercadoPago devolvió un error en la pantalla de autorización
  if (req.query.error) {
    const pendiente = await EstadoOAuth.consumir(req.query.state).catch(() => null);
    return volver(pendiente?.ambito ?? 1, {
      mp: 'error',
      mensaje: req.query.error === 'access_denied' ? 'Cancelaste la conexión con MercadoPago.' : `MercadoPago: ${req.query.error_description || req.query.error}`,
    });
  }

  try {
    const { ambito, conexion } = await mpOAuth.completarConexion({ code: req.query.code, state: req.query.state });
    volver(ambito, { mp: 'conectado', ...(conexion?.correo_vinculado ? { correo: conexion.correo_vinculado } : {}) });
  } catch (e) {
    console.warn('[mercadopago] callback OAuth:', e.message);
    volver(e.ambito ?? 1, { mp: 'error', mensaje: e.status && e.status < 500 ? e.message : `No se pudo completar la conexión: ${e.message}` });
  }
};
