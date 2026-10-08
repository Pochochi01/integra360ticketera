const crypto = require('crypto');

/**
 * Cifrado simétrico AES-256-GCM para credenciales de terceros (tokens de MercadoPago, Meta, etc.).
 * La clave sale de CREDENTIALS_KEY (32 bytes en hex o base64). Formato guardado: v1:<iv>:<tag>:<datos> (base64).
 */
const clave = () => {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) throw new Error('Falta CREDENTIALS_KEY en .env (32 bytes en hex: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('CREDENTIALS_KEY debe tener 32 bytes');
  return buf;
};

const cifrar = (texto) => {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
};

const descifrar = (valor) => {
  if (!valor) return null;
  const [version, iv, tag, datos] = String(valor).split(':');
  if (version !== 'v1') throw new Error('Formato de credencial desconocido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(datos, 'base64')), decipher.final()]).toString('utf8');
};

/** Muestra sólo el final de un secreto: "APP_USR-…a1b2". */
const enmascararSecreto = (s) => (s ? `${s.slice(0, 8)}…${s.slice(-4)}` : null);

module.exports = { cifrar, descifrar, enmascararSecreto };
