const pool = require('../config/db');
const { cifrar, descifrar, enmascararSecreto } = require('../utils/crypto');

/**
 * Integraciones por tenant. Los secretos se cifran antes de guardarse y NUNCA salen enmascarados por la API
 * (los métodos "publica" devuelven sólo lo necesario para mostrar en un panel).
 *
 * MercadoPago: id_tenant NULL = cuenta de la plataforma (cobro de suscripciones).
 */
const MercadoPago = {
  /** Credenciales descifradas (uso interno) o null. */
  obtener: async (idTenant) => {
    const [[r]] = await pool.query('SELECT * FROM mercadopago_integrations WHERE ambito = ?', [idTenant || 0]);
    if (!r) return null;
    return { ...r, access_token: descifrar(r.access_token), webhook_secret: descifrar(r.webhook_secret) };
  },

  publica: async (idTenant) => {
    const r = await MercadoPago.obtener(idTenant);
    if (!r) return null;
    return {
      id_tenant: r.id_tenant, public_key: r.public_key, collector_id: r.collector_id, modo: r.modo, activo: !!r.activo,
      access_token: enmascararSecreto(r.access_token), webhook_secret_configurado: !!r.webhook_secret, actualizado_en: r.actualizado_en,
    };
  },

  /** Alta o modificación. Si access_token / webhook_secret vienen vacíos se conservan los guardados. */
  guardar: async (idTenant, d) => {
    const actual = await MercadoPago.obtener(idTenant);
    const token = d.access_token || actual?.access_token;
    const secret = d.webhook_secret !== undefined && d.webhook_secret !== '' ? d.webhook_secret : actual?.webhook_secret;
    await pool.query(
      `INSERT INTO mercadopago_integrations (id_tenant, access_token, public_key, collector_id, webhook_secret, modo, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), public_key = VALUES(public_key), collector_id = VALUES(collector_id),
                               webhook_secret = VALUES(webhook_secret), modo = VALUES(modo), activo = VALUES(activo)`,
      [idTenant || null, cifrar(token), d.public_key, d.collector_id || null, cifrar(secret), d.modo || 'prueba', d.activo === false ? 0 : 1]
    );
    return MercadoPago.publica(idTenant);
  },

  eliminar: (idTenant) => pool.query('DELETE FROM mercadopago_integrations WHERE ambito = ?', [idTenant || 0]),
};

const Chatbot = {
  obtener: async (idTenant) => {
    const [[r]] = await pool.query('SELECT * FROM chatbot_integrations WHERE id_tenant = ?', [idTenant]);
    if (!r) return null;
    return { ...r, credentials: r.credentials ? JSON.parse(descifrar(r.credentials)) : {} };
  },

  publica: async (idTenant) => {
    const r = await Chatbot.obtener(idTenant);
    if (!r) return null;
    const c = r.credentials || {};
    return {
      id_tenant: r.id_tenant, provider: r.provider, estado: r.estado, ultimo_error: r.ultimo_error, activo: !!r.activo, actualizado_en: r.actualizado_en,
      errores_descifrado: r.errores_descifrado, regeneraciones: r.regeneraciones, conectado_en: r.conectado_en,
      credentials: r.provider === 'meta'
        ? { phone_number_id: c.phone_number_id, template: c.template || '', idioma: c.idioma || 'es_AR', access_token: enmascararSecreto(c.access_token) }
        : {},
    };
  },

  guardar: async (idTenant, { provider, credentials = {}, activo = true }) => {
    const actual = await Chatbot.obtener(idTenant);
    let cred = credentials;
    // Conserva el token de Meta si no se reenvió
    if (provider === 'meta' && actual?.provider === 'meta' && !credentials.access_token) cred = { ...credentials, access_token: actual.credentials.access_token };
    const estado = provider === 'meta' ? 'conectado' : actual?.provider === 'baileys' ? actual.estado : 'desconectado';
    await pool.query(
      `INSERT INTO chatbot_integrations (id_tenant, provider, credentials, estado, activo, ultimo_error) VALUES (?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE provider = VALUES(provider), credentials = VALUES(credentials), estado = VALUES(estado),
                               activo = VALUES(activo), ultimo_error = NULL`,
      [idTenant, provider, provider === 'meta' ? cifrar(JSON.stringify(cred)) : null, estado, activo ? 1 : 0]
    );
    return Chatbot.publica(idTenant);
  },

  /** error undefined = conserva el último error registrado; null lo limpia. */
  setEstado: (idTenant, estado, error) =>
    error === undefined
      ? pool.query('UPDATE chatbot_integrations SET estado = ? WHERE id_tenant = ?', [estado, idTenant])
      : pool.query('UPDATE chatbot_integrations SET estado = ?, ultimo_error = ? WHERE id_tenant = ?', [estado, error ? String(error).slice(0, 255) : null, idTenant]),

  eliminar: (idTenant) => pool.query('DELETE FROM chatbot_integrations WHERE id_tenant = ?', [idTenant]),
};

module.exports = { MercadoPago, Chatbot };
