const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { AppError } = require('../utils/errors');
const { UPLOADS } = require('../services/ticketImagen');

const MAX_BYTES = 3 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

/** multer en memoria: la imagen se valida y re-codifica con sharp antes de tocar el disco. */
const recibirImagen = (campo = 'imagen') => (req, res, next) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => (TIPOS.includes(file.mimetype) ? cb(null, true) : cb(new AppError(400, 'Formato no permitido (JPG, PNG o WEBP)'))),
  }).single(campo)(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'La imagen supera los 3 MB'));
    if (err instanceof multer.MulterError) return next(new AppError(400, err.message));
    next(err);
  });

/**
 * Decodifica la imagen (si no es una imagen real, sharp falla), la normaliza a JPG de hasta 1600 px
 * sin metadatos y la guarda con nombre aleatorio. Devuelve la ruta relativa a /uploads.
 */
const guardarImagenEvento = async (buffer) => {
  let salida;
  try {
    salida = await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw new AppError(400, 'El archivo no es una imagen válida');
  }
  const relativa = `eventos/${crypto.randomUUID()}.jpg`;
  fs.mkdirSync(path.join(UPLOADS, 'eventos'), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, relativa), salida);
  return relativa;
};

const borrarImagen = (relativa) => {
  if (!relativa) return;
  const abs = path.resolve(UPLOADS, relativa);
  if (abs.startsWith(UPLOADS + path.sep)) fs.rm(abs, { force: true }, () => {});
};

module.exports = { recibirImagen, guardarImagenEvento, borrarImagen };
