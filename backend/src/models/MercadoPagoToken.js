const pool = require('../config/db');
const { cifrar, descifrar } = require('../utils/crypto');

/**
 * Cuentas de MercadoPago vinculadas por OAuth.
 *   ambito = id_tenant (tipo 'tenant', cobra entradas) | 0 (tipo 'admin', la plataforma cobra suscripciones)
 * access_token y refresh_token se guardan cifrados y sólo se descifran para uso interno: la API nunca los devuelve.
 */
const tipoDe = (ambito) => (ambito ? 'tenant' : 'admin');

const desdeFila = (r) => r && { ...r, access_token: descifrar(r.access_token), refresh_token: descifrar(r.refresh_token), activo: !!r.activo, live_mode: !!r.live_mode };

const MercadoPagoToken = {
  /** Fila con tokens descifrados (uso interno) o undefined. `db` permite leerla dentro de una transacción. */
  obtener: async (ambito, db = pool) =>
    desdeFila((await db.query('SELECT * FROM mercadopago_tokens WHERE ambito = ?', [ambito || 0]))[0][0]),

  /** Lo que puede verse en un panel: sin tokens. */
  publica: async (ambito) => {
    const [[r]] = await pool.query(
      `SELECT tipo, id_tenant, correo_vinculado, mp_user_id, nickname, live_mode, activo, estado, ultimo_error,
              expira_en, conectado_en, renovado_en
         FROM mercadopago_tokens WHERE ambito = ?`,
      [ambito || 0]
    );
    return r ? { ...r, live_mode: !!r.live_mode, activo: !!r.activo, conectado: r.estado === 'conectado' } : null;
  },

  /**
   * Alta o reemplazo de la cuenta vinculada (al terminar el OAuth).
   * token = respuesta de /oauth/token; cuenta = respuesta de /users/me.
   */
  guardarConexion: async (ambito, token, cuenta) => {
    await pool.query(
      `INSERT INTO mercadopago_tokens
         (tipo, id_tenant, access_token, refresh_token, expires_in, expira_en, correo_vinculado, mp_user_id, nickname,
          public_key, live_mode, scope, activo, estado, ultimo_error, conectado_en, renovado_en)
       VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL ? SECOND, ?, ?, ?, ?, ?, ?, 1, 'conectado', NULL, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token), refresh_token = VALUES(refresh_token), expires_in = VALUES(expires_in),
         expira_en = VALUES(expira_en), correo_vinculado = VALUES(correo_vinculado), mp_user_id = VALUES(mp_user_id),
         nickname = VALUES(nickname), public_key = VALUES(public_key), live_mode = VALUES(live_mode), scope = VALUES(scope),
         estado = 'conectado', ultimo_error = NULL, conectado_en = NOW(), renovado_en = NULL`,
      [
        tipoDe(ambito), ambito || null, cifrar(token.access_token), cifrar(token.refresh_token), Number(token.expires_in),
        Number(token.expires_in), cuenta.email || null, String(token.user_id || cuenta.id), cuenta.nickname || null,
        token.public_key || null, token.live_mode === false ? 0 : 1, token.scope || null,
      ]
    );
    return MercadoPagoToken.publica(ambito);
  },

  /** Guarda los tokens nuevos de una renovación (MercadoPago rota también el refresh token). */
  guardarRenovacion: (ambito, token, db = pool) =>
    db.query(
      `UPDATE mercadopago_tokens
          SET access_token = ?, refresh_token = ?, expires_in = ?, expira_en = NOW() + INTERVAL ? SECOND,
              public_key = COALESCE(?, public_key), scope = COALESCE(?, scope),
              estado = 'conectado', ultimo_error = NULL, renovado_en = NOW()
        WHERE ambito = ?`,
      [cifrar(token.access_token), cifrar(token.refresh_token), Number(token.expires_in), Number(token.expires_in),
        token.public_key || null, token.scope || null, ambito || 0]
    ),

  /** La renovación fue rechazada (refresh token revocado o vencido): hay que volver a conectar. */
  marcarReconexion: (ambito, error) =>
    pool.query("UPDATE mercadopago_tokens SET estado = 'requiere_reconexion', ultimo_error = ? WHERE ambito = ?",
      [String(error || '').slice(0, 255), ambito || 0]),

  actualizarCuenta: (ambito, cuenta) =>
    pool.query('UPDATE mercadopago_tokens SET correo_vinculado = ?, nickname = ? WHERE ambito = ?',
      [cuenta.email || null, cuenta.nickname || null, ambito || 0]),

  setActivo: (ambito, activo) => pool.query('UPDATE mercadopago_tokens SET activo = ? WHERE ambito = ?', [activo ? 1 : 0, ambito || 0]),

  /** Ámbitos conectados cuyo access token vence dentro de `segundos`. */
  porVencer: async (segundos) =>
    (await pool.query(
      "SELECT ambito FROM mercadopago_tokens WHERE estado = 'conectado' AND expira_en < NOW() + INTERVAL ? SECOND",
      [segundos]
    ))[0].map((r) => r.ambito),

  /** Ámbito (id_tenant o 0) de la cuenta de MercadoPago que recibió un pago, o null si no está vinculada. */
  ambitoDeCuenta: async (mpUserId) =>
    (await pool.query('SELECT ambito FROM mercadopago_tokens WHERE mp_user_id = ? ORDER BY ambito LIMIT 1', [String(mpUserId)]))[0][0]?.ambito ?? null,

  eliminar: (ambito) => pool.query('DELETE FROM mercadopago_tokens WHERE ambito = ?', [ambito || 0]),
};

/** "state" de OAuth: de un solo uso, vence a los 10 minutos. */
const EstadoOAuth = {
  crear: (state, { ambito, idUsuario, codeVerifier }) =>
    pool.query(
      'INSERT INTO mercadopago_oauth_estados (state, ambito, id_usuario, code_verifier, expira_en) VALUES (?, ?, ?, ?, NOW() + INTERVAL 10 MINUTE)',
      [state, ambito || 0, idUsuario, cifrar(codeVerifier)]
    ),

  /** Lo borra al leerlo (no se puede reutilizar). Devuelve null si no existe o venció. */
  consumir: async (state) => {
    if (!/^[\w-]{43}$/.test(String(state || ''))) return null;
    return pool.withTransaction(async (conn) => {
      const [[r]] = await conn.query('SELECT *, expira_en > NOW() AS vigente FROM mercadopago_oauth_estados WHERE state = ? FOR UPDATE', [state]);
      if (!r) return null;
      await conn.query('DELETE FROM mercadopago_oauth_estados WHERE state = ?', [state]);
      return r.vigente ? { ambito: r.ambito, idUsuario: r.id_usuario, codeVerifier: descifrar(r.code_verifier) } : null;
    });
  },

  limpiarVencidos: () => pool.query('DELETE FROM mercadopago_oauth_estados WHERE expira_en < NOW()'),
};

module.exports = { MercadoPagoToken, EstadoOAuth };
