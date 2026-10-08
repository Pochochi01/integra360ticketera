const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const QRCode = require('qrcode');

/**
 * Compone la entrada como PNG: imagen del evento arriba, QR (con la miniatura del evento al centro)
 * y los datos del ticket. El QR usa corrección de errores alta (H) para tolerar el logo central.
 */
const ANCHO = 640;
const ALTO_BANNER = 320;
const QR = 400;
const ALTO = 1040;
const UPLOADS = path.resolve(__dirname, '../../uploads');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const recortar = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Ruta absoluta segura de una imagen subida (evita salir de /uploads). */
const rutaImagen = (relativa) => {
  if (!relativa) return null;
  const abs = path.resolve(UPLOADS, relativa);
  return abs.startsWith(UPLOADS + path.sep) && fs.existsSync(abs) ? abs : null;
};

const bannerPorDefecto = (color) =>
  Buffer.from(
    `<svg width="${ANCHO}" height="${ALTO_BANNER}" xmlns="http://www.w3.org/2000/svg">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#c026d3"/></linearGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/>
       <text x="50%" y="55%" font-size="96" text-anchor="middle" fill="white" font-family="Segoe UI Emoji, sans-serif">🎟</text>
     </svg>`
  );

const generarImagenTicket = async ({ codigo, evento, fecha, lugar, tipo, asiento, titular, tenant, imagen, color = '#4f46e5', indice, total }) => {
  const imgPath = rutaImagen(imagen);

  const banner = imgPath
    ? await sharp(imgPath).resize(ANCHO, ALTO_BANNER, { fit: 'cover' }).png().toBuffer()
    : await sharp(bannerPorDefecto(color)).png().toBuffer();

  let qr = await QRCode.toBuffer(codigo, { errorCorrectionLevel: 'H', width: QR, margin: 1 });
  if (imgPath) {
    const lado = Math.round(QR * 0.22);
    const miniatura = await sharp(imgPath).resize(lado, lado, { fit: 'cover' })
      .composite([{ input: Buffer.from(`<svg width="${lado}" height="${lado}"><rect width="${lado}" height="${lado}" rx="14" fill="none" stroke="white" stroke-width="8"/></svg>`) }])
      .png().toBuffer();
    qr = await sharp(qr).composite([{ input: miniatura, gravity: 'center' }]).png().toBuffer();
  }

  const yTexto = ALTO_BANNER + 36;
  const textos = Buffer.from(
    `<svg width="${ANCHO}" height="${ALTO}" xmlns="http://www.w3.org/2000/svg">
       <style>.t{font-family:Segoe UI, Arial, sans-serif}</style>
       <text class="t" x="32" y="${yTexto}" font-size="18" fill="${esc(color)}" font-weight="600">${esc(recortar(tenant, 48))}</text>
       <text class="t" x="32" y="${yTexto + 34}" font-size="28" fill="#0f172a" font-weight="700">${esc(recortar(evento, 36))}</text>
       <text class="t" x="32" y="${yTexto + 62}" font-size="17" fill="#475569">${esc(recortar(`${fecha} · ${lugar}`, 60))}</text>
       <text class="t" x="${ANCHO / 2}" y="${ALTO - 88}" font-size="22" fill="#0f172a" text-anchor="middle" font-weight="700">${esc(recortar(`${tipo}${asiento ? ` · ${asiento}` : ''}`, 44))}</text>
       <text class="t" x="${ANCHO / 2}" y="${ALTO - 58}" font-size="16" fill="#475569" text-anchor="middle">${esc(recortar(`Titular: ${titular}`, 60))}${total > 1 ? esc(` · Entrada ${indice}/${total}`) : ''}</text>
       <text class="t" x="${ANCHO / 2}" y="${ALTO - 28}" font-size="12" fill="#94a3b8" text-anchor="middle" font-family="Consolas, monospace">${esc(codigo)}</text>
     </svg>`
  );

  return sharp({ create: { width: ANCHO, height: ALTO, channels: 4, background: '#ffffff' } })
    .composite([
      { input: banner, top: 0, left: 0 },
      { input: qr, top: yTexto + 96, left: (ANCHO - QR) / 2 },
      { input: textos, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
};

module.exports = { generarImagenTicket, rutaImagen, UPLOADS };
