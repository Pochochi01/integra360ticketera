const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../config/db');

/**
 * Entradas por correo (Nodemailer). Al confirmarse el pago se envía al comprador un correo con un link de
 * descarga por cada ticket: 2 entradas → 2 links. Cada link es único (tickets.token_descarga) y descarga sólo
 * esa entrada, con su QR único.
 *
 * Configuración (.env):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true para 465), SMTP_USER, SMTP_PASS, MAIL_FROM
 * Sin SMTP_HOST el correo no se puede enviar: los tickets quedan en 'failed' con el motivo, y el admin o el
 * vendedor pueden reenviarlo después o mandar los links por WhatsApp.
 *
 * Estado por ticket: tickets.email_status ('pending' | 'sent' | 'failed'), email_sent_at y email_error.
 * Nunca lanza: un correo que falla no debe afectar al webhook ni a la venta.
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
// Mismo dominio que el sitio: nginx publica /api en el VPS (y Vite lo redirige en desarrollo)
const urlDescarga = (token) => `${frontend()}/api/publico/tickets/${token}/descargar`;

let transporte = null;
/** Transporte SMTP (perezoso). Las pruebas lo reemplazan con setTransporte. */
const obtenerTransporte = () => {
  if (transporte) return transporte;
  if (!process.env.SMTP_HOST) return null;
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    // Corto: el envío corre dentro del procesamiento del webhook
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  return transporte;
};
const setTransporte = (t) => { transporte = t; };

/** Asegura el token de descarga de cada ticket vigente de la venta y devuelve los tickets con su link. */
const ticketsConLink = async (idVenta) => {
  const [tickets] = await pool.query(
    `SELECT t.id_ticket, t.token_descarga, t.estado, t.email_status, t.email_sent_at, t.email_error, tt.nombre_tipo
       FROM tickets t JOIN ventas v ON v.id_venta = t.id_venta JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo
      WHERE t.id_venta = ? AND t.id_usuario = v.id_usuario AND t.estado IN ('valido','usado')
      ORDER BY t.id_ticket`, [idVenta]);
  for (const t of tickets) {
    if (!t.token_descarga) {
      t.token_descarga = crypto.randomBytes(20).toString('hex');
      await pool.query('UPDATE tickets SET token_descarga = ? WHERE id_ticket = ? AND token_descarga IS NULL', [t.token_descarga, t.id_ticket]);
    }
  }
  return tickets.map((t, i) => ({ ...t, numero: i + 1, url: urlDescarga(t.token_descarga) }));
};

/** Estado del correo de una venta a partir de sus tickets: failed si alguno falló, sent si todos salieron. */
const estadoCorreoVenta = (tickets) => {
  if (!tickets.length) return null;
  if (tickets.some((t) => t.email_status === 'failed')) return 'failed';
  if (tickets.every((t) => t.email_status === 'sent')) return 'sent';
  if (tickets.some((t) => t.email_status === 'pending')) return 'pending';
  return null;
};

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const armarCorreo = ({ venta, tickets }) => {
  const fecha = new Date(String(venta.fecha_evento).replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'full', timeStyle: 'short' });
  const asunto = `Tus entradas para ${venta.evento}`;
  const lineas = tickets.map((t) => `Entrada ${t.numero} de ${tickets.length} · ${t.nombre_tipo}: ${t.url}`);
  const texto = [
    `¡Hola ${venta.comprador}!`, '', `Tu compra en ${venta.tenant} está confirmada.`, `${venta.evento} · ${fecha}`, '',
    'Descargá cada entrada (cada una tiene su QR único, presentalo en la puerta):', ...lineas, '',
    `También podés ver todas tus entradas acá: ${frontend()}/entrada/${venta.token_acceso}`,
  ].join('\n');
  const botones = tickets.map((t) => `
    <tr><td style="padding:6px 0">
      <a href="${escapar(t.url)}" style="display:block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 16px;border-radius:999px;font-weight:600;text-align:center">
        Descargar entrada ${t.numero} de ${tickets.length} · ${escapar(t.nombre_tipo)}
      </a>
    </td></tr>`).join('');
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:24px" cellpadding="0" cellspacing="0">
      <tr><td><p style="margin:0 0 4px;color:#71717a;font-size:14px">${escapar(venta.tenant)}</p>
        <h1 style="margin:0 0 8px;font-size:22px">¡Tu compra está confirmada!</h1>
        <p style="margin:0 0 16px;font-size:15px"><b>${escapar(venta.evento)}</b><br>${escapar(fecha)}</p>
        <p style="margin:0 0 8px;font-size:14px">Cada entrada tiene su QR único. Descargalas y presentalas en la puerta:</p></td></tr>
      ${botones}
      <tr><td style="padding-top:16px;font-size:13px;color:#71717a">
        También podés ver todas tus entradas en <a href="${escapar(`${frontend()}/entrada/${venta.token_acceso}`)}" style="color:#4f46e5">tu página de entradas</a>.
        No compartas estos links: cada uno da acceso a una entrada.</td></tr>
    </table></td></tr></table></body></html>`;
  return { asunto, texto, html };
};

/**
 * Envía (o reenvía) el correo con las entradas de una venta pagada. Devuelve
 * { enviado, estado, destino, tickets: [{ id_ticket, url }], motivo? }.
 */
const enviarEntradasPorCorreo = async (idVenta) => {
  try {
    const [[venta]] = await pool.query(
      `SELECT v.id_venta, v.estado, v.token_acceso, v.origen, e.nombre AS evento, e.fecha AS fecha_evento, tn.nombre AS tenant,
              CONCAT_WS(' ', u.nombre, u.apellido) AS comprador, u.email
         FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento JOIN tenants tn ON tn.id_tenant = e.id_tenant
         JOIN usuarios u ON u.id_usuario = v.id_usuario WHERE v.id_venta = ?`, [idVenta]);
    if (!venta) return { enviado: false, motivo: 'Venta inexistente' };
    if (venta.estado !== 'pagado') return { enviado: false, motivo: 'La venta no está pagada' }; // sólo con el pago confirmado
    const tickets = await ticketsConLink(idVenta);
    if (!tickets.length) return { enviado: false, motivo: 'La venta no tiene entradas vigentes' };
    const ids = tickets.map((t) => t.id_ticket);
    const marcar = (estado, error = null) => pool.query(
      'UPDATE tickets SET email_status = ?, email_sent_at = NOW(), email_error = ? WHERE id_ticket IN (?)', [estado, error, ids]);
    const resultado = (estado, extra = {}) => ({ estado, destino: venta.email, tickets: tickets.map((t) => ({ id_ticket: t.id_ticket, url: t.url })), ...extra });

    // Venta de boletería sin datos del cliente: la entrada la ve en su celular / en la pantalla; no es un fallo
    if (!venta.email && venta.origen === 'puerta_asistida') return resultado(null, { enviado: false, motivo: 'Venta en puerta sin email del cliente' });
    if (!venta.email) {
      await marcar('failed', 'El comprador no tiene email');
      return resultado('failed', { enviado: false, motivo: 'El comprador no tiene email' });
    }
    const t = obtenerTransporte();
    if (!t) {
      await marcar('failed', 'El servidor de correo (SMTP) no está configurado');
      return resultado('failed', { enviado: false, motivo: 'El servidor de correo (SMTP) no está configurado' });
    }
    await marcar('pending');
    const { asunto, texto, html } = armarCorreo({ venta, tickets });
    try {
      await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: venta.email, subject: asunto, text: texto, html });
    } catch (e) {
      const motivo = String(e.message || e).slice(0, 250);
      await marcar('failed', motivo);
      console.warn(`[correo] venta ${idVenta}: ${motivo}`);
      return resultado('failed', { enviado: false, motivo });
    }
    await marcar('sent');
    return resultado('sent', { enviado: true });
  } catch (e) {
    console.error(`[correo] venta ${idVenta}`, e.message);
    return { enviado: false, motivo: e.message };
  }
};

/**
 * Estado del correo y links por ticket de cada venta pagada (para los paneles del admin y del vendedor).
 * ventas: filas con id_venta y estado.
 */
const correosDeVentas = async (ventas) => {
  const salida = [];
  for (const v of ventas) {
    if (v.estado !== 'pagado') { salida.push({ ...v, estado_correo: null, tickets_links: [] }); continue; }
    const tickets = await ticketsConLink(v.id_venta);
    salida.push({
      ...v,
      estado_correo: estadoCorreoVenta(tickets),
      correo_enviado_en: tickets.reduce((max, t) => (t.email_sent_at && (!max || t.email_sent_at > max) ? t.email_sent_at : max), null),
      correo_error: tickets.find((t) => t.email_status === 'failed')?.email_error || null,
      tickets_links: tickets.map((t) => ({ id_ticket: t.id_ticket, numero: t.numero, tipo: t.nombre_tipo, url: t.url, email_status: t.email_status })),
    });
  }
  return salida;
};

module.exports = { correosDeVentas, enviarEntradasPorCorreo, ticketsConLink, estadoCorreoVenta, urlDescarga, setTransporte, armarCorreo };
