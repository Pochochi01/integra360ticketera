const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

const TIPOS_MOVIL = ['MOBILE', 'FIXED_LINE_OR_MOBILE'];

/**
 * Valida un número de WhatsApp y lo devuelve normalizado en formato E.164 (+5491123456789).
 * Devuelve null si no es un celular válido.
 *
 * Argentina: WhatsApp usa el prefijo móvil 9 (+54 9 …). Si el usuario escribe el número
 * sin el 9 ni el 15 (ej. "11 2345 6789") se reintenta como celular.
 */
const normalizarWhatsapp = (valor, paisDefecto = 'AR') => {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!/^[+\d\s().-]{6,25}$/.test(texto)) return null;

  let n = parsePhoneNumberFromString(texto, paisDefecto);
  if (n?.isValid() && n.country === 'AR' && !TIPOS_MOVIL.includes(n.getType())) {
    n = parsePhoneNumberFromString(`+549${n.nationalNumber}`);
  }
  if (!n?.isValid() || !TIPOS_MOVIL.includes(n.getType())) return null;
  return n.number;
};

/** Oculta parte del número para mostrarlo a terceros (+54911****6789). */
const enmascarar = (e164) => (e164 ? e164.replace(/^(\+\d{5})\d+(\d{4})$/, '$1****$2') : null);

module.exports = { normalizarWhatsapp, enmascarar };
