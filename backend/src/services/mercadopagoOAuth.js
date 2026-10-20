const crypto = require('crypto');
const mp = require('./mercadopagoService');
const { MercadoPagoToken, EstadoOAuth } = require('../models/MercadoPagoToken');
const { AppError } = require('../utils/errors');

/**
 * Vinculación de cuentas de MercadoPago por OAuth (Authorization Code + refresh token).
 *
 * La plataforma registra UNA aplicación en MercadoPago Developers (MP_CLIENT_ID / MP_CLIENT_SECRET).
 * Cada complejo, y la plataforma misma, autoriza a esa aplicación a cobrar en su propia cuenta.
 *
 *   1. urlDeAutorizacion()  → link a auth.mercadopago.com con un "state" de un solo uso (+ PKCE)
 *   2. el titular inicia sesión en MercadoPago y acepta
 *   3. MercadoPago redirige a MP_REDIRECT_URI?code=…&state=…
 *   4. completarConexion()  → canjea el code por access_token + refresh_token y los guarda cifrados
 */
const config = () => {
  const backend = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
  return {
    clientId: process.env.MP_CLIENT_ID,
    clientSecret: process.env.MP_CLIENT_SECRET,
    redirectUri: process.env.MP_REDIRECT_URI || `${backend}/api/auth/mercadopago/callback`,
    authUrl: process.env.MP_AUTH_URL || 'https://auth.mercadopago.com/authorization',
    // Activar sólo si se habilitó PKCE en "Detalles de aplicación" (ahí pasa a ser obligatorio)
    pkce: process.env.MP_PKCE === 'true',
    // Credenciales de prueba (sandbox): test_token = true
    testToken: process.env.MP_TEST_TOKEN === 'true',
  };
};

const configurada = () => Boolean(config().clientId && config().clientSecret);

const exigirConfiguracion = () => {
  if (!configurada()) {
    throw new AppError(503, 'La aplicación de MercadoPago no está configurada en el servidor (MP_CLIENT_ID / MP_CLIENT_SECRET)');
  }
};

const base64url = (buf) => buf.toString('base64url');

/** ambito: id_tenant (complejo) o 0 (plataforma). Devuelve la URL a la que se envía al usuario. */
const urlDeAutorizacion = async ({ ambito, idUsuario }) => {
  exigirConfiguracion();
  const c = config();
  const state = base64url(crypto.randomBytes(32)); // 43 caracteres, sin datos sensibles
  const codeVerifier = c.pkce ? base64url(crypto.randomBytes(48)) : null; // 64 caracteres
  await EstadoOAuth.limpiarVencidos();
  await EstadoOAuth.crear(state, { ambito, idUsuario, codeVerifier });

  const url = new URL(c.authUrl);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', c.redirectUri);
  if (codeVerifier) {
    url.searchParams.set('code_challenge', base64url(crypto.createHash('sha256').update(codeVerifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
};

/**
 * Callback: valida el state (existe, no venció, no se usó), canjea el código y guarda la cuenta.
 * Devuelve { ambito, cuenta } o lanza AppError con un mensaje para mostrar al usuario.
 */
const completarConexion = async ({ code, state }) => {
  exigirConfiguracion();
  const pendiente = await EstadoOAuth.consumir(state);
  if (!pendiente) throw new AppError(400, 'El enlace de conexión venció o ya se usó. Volvé a tocar «Conectar con MercadoPago».');
  if (!code) throw Object.assign(new AppError(400, 'Falta el código de autorización'), { ambito: pendiente.ambito });

  const c = config();
  let token;
  try {
    token = await mp.oauthToken({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
      ...(pendiente.codeVerifier ? { code_verifier: pendiente.codeVerifier } : {}),
      ...(c.testToken ? { test_token: 'true' } : {}),
    });
  } catch (e) {
    throw Object.assign(new AppError(502, `MercadoPago rechazó la autorización: ${e.message}`), { ambito: pendiente.ambito });
  }
  if (!token.refresh_token) {
    // Sin refresh token no se podría renovar: la app debe tener el permiso offline_access
    throw Object.assign(new AppError(502, 'MercadoPago no devolvió refresh token: revisá que la aplicación tenga el permiso offline_access'), { ambito: pendiente.ambito });
  }
  const cuenta = await mp.cuentaDelToken(token.access_token).catch(() => ({ id: token.user_id }));
  const conexion = await MercadoPagoToken.guardarConexion(pendiente.ambito, token, cuenta);
  return { ambito: pendiente.ambito, idUsuario: pendiente.idUsuario, conexion };
};

module.exports = { config, configurada, urlDeAutorizacion, completarConexion };
