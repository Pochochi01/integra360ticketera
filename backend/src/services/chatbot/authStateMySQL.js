const pool = require('../../config/db');
const { cifrar, descifrar } = require('../../utils/crypto');

/**
 * Auth state de Baileys persistido en MySQL (tabla baileys_auth), reemplazo de useMultiFileAuthState.
 *
 * - Cada credencial / clave Signal es una fila (id_tenant, categoria, clave) con el JSON (BufferJSON) cifrado.
 * - Las escrituras de un lote de claves van en una transacción: o se guardan todas o ninguna,
 *   evitando sesiones a medio escribir (una de las causas de "Bad MAC").
 * - Si una fila no se puede descifrar o parsear se lanza SesionCorruptaError: el gestor borra la sesión
 *   y pide un QR nuevo en lugar de seguir operando con claves dañadas.
 */
class SesionCorruptaError extends Error {
  constructor(detalle) {
    super(`Sesión de WhatsApp corrupta: ${detalle}`);
    this.name = 'SesionCorruptaError';
  }
}

const CREDS = 'creds';

/** Convierte una fila en objeto; cualquier fallo de descifrado/parseo = sesión corrupta. */
const leerValor = (BufferJSON, fila) => {
  try {
    return JSON.parse(descifrar(fila.valor), BufferJSON.reviver);
  } catch (err) {
    throw new SesionCorruptaError(`${fila.categoria}/${fila.clave} (${err.message})`);
  }
};
const escribirValor = (BufferJSON, valor) => cifrar(JSON.stringify(valor, BufferJSON.replacer));

/**
 * @param idTenant  complejo dueño de la sesión
 * @param baileys   módulo 'baileys' ya importado (ESM)
 * @returns { state, saveCreds, existe }
 */
const useMySQLAuthState = async (idTenant, baileys) => {
  const { BufferJSON, initAuthCreds, proto } = baileys;

  const [[filaCreds]] = await pool.query('SELECT * FROM baileys_auth WHERE id_tenant = ? AND categoria = ? AND clave = ?', [idTenant, CREDS, CREDS]);
  const existe = !!filaCreds;
  const creds = filaCreds ? leerValor(BufferJSON, filaCreds) : initAuthCreds();
  if (existe && (!creds?.noiseKey?.private || !creds?.signedIdentityKey?.private)) {
    throw new SesionCorruptaError('credenciales incompletas');
  }

  const keys = {
    /** Devuelve { id: valor } para las claves pedidas (las inexistentes no se incluyen). */
    get: async (tipo, ids) => {
      if (!ids.length) return {};
      const [filas] = await pool.query('SELECT * FROM baileys_auth WHERE id_tenant = ? AND categoria = ? AND clave IN (?)', [idTenant, tipo, ids]);
      const r = {};
      for (const f of filas) {
        let v = leerValor(BufferJSON, f);
        if (tipo === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
        r[f.clave] = v;
      }
      return r;
    },

    /** data: { tipo: { id: valor | null } } — null borra la clave. Todo en una transacción. */
    set: async (data) => {
      const altas = [];
      const bajas = [];
      for (const tipo of Object.keys(data)) {
        for (const [id, valor] of Object.entries(data[tipo] || {})) {
          if (valor === null || valor === undefined) bajas.push([idTenant, tipo, id]);
          else altas.push([idTenant, tipo, id, escribirValor(BufferJSON, valor)]);
        }
      }
      if (!altas.length && !bajas.length) return;
      await pool.withTransaction(async (conn) => {
        if (altas.length) {
          await conn.query('INSERT INTO baileys_auth (id_tenant, categoria, clave, valor) VALUES ? ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [altas]);
        }
        if (bajas.length) {
          await conn.query('DELETE FROM baileys_auth WHERE (id_tenant, categoria, clave) IN (?)', [bajas]);
        }
      });
    },

    clear: () => borrarSesion(idTenant),
  };

  const saveCreds = () =>
    pool.query(
      'INSERT INTO baileys_auth (id_tenant, categoria, clave, valor) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [idTenant, CREDS, CREDS, escribirValor(BufferJSON, creds)]
    );

  return { state: { creds, keys }, saveCreds, existe };
};

/** Elimina toda la sesión del complejo (credenciales y claves): el próximo inicio pedirá QR. */
const borrarSesion = (idTenant) => pool.query('DELETE FROM baileys_auth WHERE id_tenant = ?', [idTenant]);

/** ¿Hay una sesión vinculada guardada? (para reconectar al iniciar el servidor) */
const tieneSesion = async (idTenant) =>
  (await pool.query("SELECT 1 FROM baileys_auth WHERE id_tenant = ? AND categoria = 'creds' LIMIT 1", [idTenant]))[0].length > 0;

module.exports = { useMySQLAuthState, borrarSesion, tieneSesion, SesionCorruptaError };
