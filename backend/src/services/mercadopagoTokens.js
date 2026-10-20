const pool = require('../config/db');
const mp = require('./mercadopagoService');
const { config } = require('./mercadopagoOAuth');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { AppError } = require('../utils/errors');

/**
 * Mantiene vigentes los access tokens de MercadoPago.
 *
 * - credencialesValidas(ambito): devuelve un access token usable. Si vence dentro del margen
 *   (MP_RENOVAR_ANTES_DIAS, 7 días por defecto) lo renueva antes con el refresh token.
 * - conCredenciales(ambito, fn): ejecuta una llamada a MercadoPago y, si responde 401 (token revocado
 *   o vencido antes de tiempo), renueva una vez y reintenta.
 * - renovarPorVencer(): tarea periódica que renueva los que están por vencer aunque nadie cobre.
 *
 * MercadoPago ROTA el refresh token en cada renovación (el anterior deja de servir), así que dos
 * renovaciones simultáneas de la misma cuenta romperían la conexión. Por eso se serializan con
 * GET_LOCK de MySQL, que además funciona con varias instancias del backend.
 */
const margenSegundos = () => Number(process.env.MP_RENOVAR_ANTES_DIAS || 7) * 24 * 3600;

const MENSAJE_RECONEXION = (ambito) =>
  ambito === 0
    ? 'La cuenta de MercadoPago de la plataforma necesita volver a conectarse'
    : 'La cuenta de MercadoPago del complejo necesita volver a conectarse';

/** Renueva con el refresh token (con la fila bloqueada por GET_LOCK). Devuelve la fila actualizada. */
const renovar = async (ambito, { forzar = false, tokenFallido = null } = {}) => {
  const conn = await pool.getConnection();
  const lock = `mp_refresh_${ambito}`;
  try {
    const [[{ ok }]] = await conn.query('SELECT GET_LOCK(?, 15) AS ok', [lock]);
    if (!ok) throw new AppError(503, 'MercadoPago está ocupado renovando la conexión, reintentá en unos segundos');
    // Releer adentro del lock: otra petición pudo haberlo renovado mientras esperábamos
    const fila = await MercadoPagoToken.obtener(ambito, conn);
    if (!fila) throw new AppError(409, ambito === 0 ? 'La plataforma no tiene MercadoPago conectado' : 'El complejo no tiene MercadoPago conectado');
    if (fila.estado !== 'conectado') throw new AppError(409, MENSAJE_RECONEXION(ambito));
    const restante = (new Date(fila.expira_en).getTime() - Date.now()) / 1000;
    if (!forzar && restante > margenSegundos()) return fila;
    // Forzado por un 401: si otra petición ya lo cambió mientras esperábamos el lock, usar el nuevo
    if (forzar && tokenFallido && fila.access_token !== tokenFallido) return fila;

    const c = config();
    let token;
    try {
      token = await mp.oauthToken({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: fila.refresh_token,
      });
    } catch (e) {
      // invalid_grant / 400 / 401: el titular revocó el acceso o el refresh token venció
      if (e.codigo === 'invalid_grant' || [400, 401, 403].includes(e.status)) {
        await MercadoPagoToken.marcarReconexion(ambito, e.message);
        throw new AppError(409, MENSAJE_RECONEXION(ambito));
      }
      throw new AppError(502, `No se pudo renovar el acceso a MercadoPago: ${e.message}`); // error transitorio: se reintenta luego
    }
    await MercadoPagoToken.guardarRenovacion(ambito, { ...token, refresh_token: token.refresh_token || fila.refresh_token }, conn);
    return MercadoPagoToken.obtener(ambito, conn);
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    conn.release();
  }
};

/**
 * Credenciales listas para llamar a la API: { ambito, access_token, public_key, live_mode, mp_user_id, activo }.
 * Lanza 409 si la cuenta no está conectada o necesita reconexión.
 */
const credencialesValidas = async (ambito, { forzar = false, tokenFallido = null } = {}) => {
  let fila = await MercadoPagoToken.obtener(ambito);
  if (!fila) throw new AppError(409, ambito === 0 ? 'La plataforma no tiene MercadoPago conectado' : 'El complejo no tiene MercadoPago conectado');
  if (fila.estado !== 'conectado') throw new AppError(409, MENSAJE_RECONEXION(ambito));
  const restante = (new Date(fila.expira_en).getTime() - Date.now()) / 1000;
  if (forzar || restante <= margenSegundos()) fila = await renovar(ambito, { forzar, tokenFallido });
  return {
    ambito,
    access_token: fila.access_token,
    public_key: fila.public_key,
    live_mode: fila.live_mode,
    mp_user_id: fila.mp_user_id,
    activo: fila.activo,
  };
};

/** Ejecuta fn(cred) y, si MercadoPago responde 401, renueva el token una vez y reintenta. */
const conCredenciales = async (ambito, fn) => {
  const cred = await credencialesValidas(ambito);
  try {
    return await fn(cred);
  } catch (e) {
    if (!(e instanceof mp.MercadoPagoError) || e.status !== 401) throw e;
    return fn(await credencialesValidas(ambito, { forzar: true, tokenFallido: cred.access_token }));
  }
};

/** Tarea periódica: renueva todos los tokens que vencen dentro del margen. Devuelve un resumen. */
const renovarPorVencer = async () => {
  const resumen = { renovados: 0, requierenReconexion: 0, errores: 0 };
  for (const ambito of await MercadoPagoToken.porVencer(margenSegundos())) {
    try {
      await renovar(ambito);
      resumen.renovados++;
    } catch (e) {
      if (e.status === 409) resumen.requierenReconexion++;
      else resumen.errores++;
      console.warn(`[mercadopago] no se pudo renovar el ámbito ${ambito}: ${e.message}`);
    }
  }
  return resumen;
};

module.exports = { credencialesValidas, conCredenciales, renovarPorVencer };
