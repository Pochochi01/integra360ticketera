const crypto = require('crypto');

/** Sin caracteres que se confunden al dictarlos o copiarlos a mano (0/O, 1/l/I). */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Contraseña aleatoria criptográficamente segura (por defecto 10 caracteres ≈ 58 bits). */
const generarPassword = (largo = 10) => Array.from({ length: largo }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');

/** "José Pérez" → "jose.perez" (minúsculas, sin acentos, sólo a-z 0-9 y puntos). */
const aIdentificador = (texto) =>
  String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30);

/**
 * Nombre de usuario único: "<complejo>.<nombre>", y si ya existe "<complejo>.<nombre>2", "…3", etc.
 * `tomados` son los usuarios existentes con ese prefijo. La UNIQUE KEY de la tabla resuelve las carreras.
 */
const generarUsuario = (slugComplejo, nombre, apellido, tomados = []) => {
  const base = [aIdentificador(slugComplejo).slice(0, 20), aIdentificador([nombre, apellido].filter(Boolean).join(' ')) || 'portero'].join('.').slice(0, 55);
  const usados = new Set(tomados);
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) if (!usados.has(`${base}${n}`)) return `${base}${n}`;
};

module.exports = { generarPassword, generarUsuario, aIdentificador };
