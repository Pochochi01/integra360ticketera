const pool = require('../config/db');
const { cifrar, descifrar, enmascararSecreto } = require('../utils/crypto');

/**
 * Integraciones de chatbot por tenant. Los secretos se cifran antes de guardarse y los métodos "publica"
 * devuelven sólo lo necesario para mostrar en un panel.
 * (MercadoPago se vincula por OAuth: ver models/MercadoPagoToken.js)
 */
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

module.exports = { Chatbot };
