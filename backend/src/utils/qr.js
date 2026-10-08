const crypto = require('crypto');
const QRCode = require('qrcode');

const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos

/** Código único e impredecible por ticket (se guarda en tickets.codigo_qr, UNIQUE). */
const generarCodigo = () => 'TK-' + crypto.randomBytes(16).toString('hex').toUpperCase();

/** Código corto y legible para links de venta (/v/:codigo). */
const generarCodigoLink = (largo = 10) =>
  Array.from(crypto.randomBytes(largo), (b) => ALFABETO[b % ALFABETO.length]).join('');

/** Token secreto del link público de entradas de una venta (/entrada/:token). */
const generarTokenAcceso = () => crypto.randomBytes(20).toString('hex');

/** Imagen QR en formato data URL para mostrar en el frontend. */
const codigoAImagen = (codigo) => QRCode.toDataURL(codigo, { width: 280, margin: 1 });

module.exports = { generarCodigo, generarCodigoLink, generarTokenAcceso, codigoAImagen };
