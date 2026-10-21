const pool = require('../config/db');
const chatbot = require('./chatbot');

const PLANTILLA_ENTRADAS =
  '¡Hola {nombre}! 🎟️ Tu compra en {tenant} está confirmada.\n' +
  'Evento: {evento} ({fecha})\nEntradas: {cantidad}\n\n' +
  'Mirá tus entradas con el código QR acá:\n{link}\n\n' +
  'Presentá el QR en el ingreso. No compartas este link.';

const PLANTILLA_LINK_VENTA = '¡Hola! Soy {vendedor} de {tenant} 👋\nConseguí tus entradas{evento} acá:\n{link}';

const aplicarPlantilla = (plantilla, datos) => plantilla.replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? '');
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const linkEntrada = (token) => `${frontend()}/entrada/${token}`;
const linkVenta = (codigo) => `${frontend()}/v/${codigo}`;
const fechaLarga = (f) => new Date(String(f).replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });

/** Envía por el chatbot del tenant y registra el resultado en mensajes_whatsapp. Nunca lanza. */
const enviarYRegistrar = async ({ idTenant, tipo, idVenta = null, idLink = null, destino, cuerpo, link }) => {
  const canal = await chatbot.resolver(idTenant);
  try {
    const { id } = await canal.enviar(destino, { cuerpo, link });
    await pool.query(
      "INSERT INTO mensajes_whatsapp (id_tenant, tipo, id_venta, id_link, destino, cuerpo, proveedor, estado, id_externo) VALUES (?, ?, ?, ?, ?, ?, ?, 'enviado', ?)",
      [idTenant, tipo, idVenta, idLink, destino, cuerpo, canal.provider, id ? String(id).slice(0, 255) : null]
    );
    return { enviado: true, provider: canal.provider };
  } catch (err) {
    await pool.query(
      "INSERT INTO mensajes_whatsapp (id_tenant, tipo, id_venta, id_link, destino, cuerpo, proveedor, estado, error) VALUES (?, ?, ?, ?, ?, ?, ?, 'error', ?)",
      [idTenant, tipo, idVenta, idLink, destino, cuerpo, canal.provider, err.message.slice(0, 255)]
    ).catch(() => {});
    return { enviado: false, provider: canal.provider, motivo: err.message };
  }
};

/** Link de las entradas de una venta pagada, por el chatbot del complejo. */
const enviarEntradasPorWhatsapp = async (idVenta) => {
  try {
    const [[v]] = await pool.query(
      `SELECT v.id_venta, v.estado, v.whatsapp_contacto, v.token_acceso, u.nombre AS comprador, e.nombre AS evento, e.fecha AS fecha_evento,
              t.id_tenant, t.nombre AS tenant, t.mensaje_whatsapp,
              (SELECT COUNT(*) FROM tickets tk WHERE tk.id_venta = v.id_venta AND tk.estado = 'valido') AS cantidad
         FROM ventas v
         JOIN usuarios u ON u.id_usuario = v.id_usuario
         JOIN eventos e ON e.id_evento = v.id_evento
         JOIN tenants t ON t.id_tenant = e.id_tenant
        WHERE v.id_venta = ?`,
      [idVenta]
    );
    if (!v || v.estado !== 'pagado' || !v.whatsapp_contacto) return { enviado: false, motivo: 'Sin WhatsApp o venta no pagada' };
    const link = linkEntrada(v.token_acceso);
    const cuerpo = aplicarPlantilla(v.mensaje_whatsapp || PLANTILLA_ENTRADAS, {
      nombre: v.comprador.split(' ')[0], tenant: v.tenant, evento: v.evento, fecha: fechaLarga(v.fecha_evento), cantidad: v.cantidad, link,
    });
    return enviarYRegistrar({ idTenant: v.id_tenant, tipo: 'entradas', idVenta: v.id_venta, destino: v.whatsapp_contacto, cuerpo, link });
  } catch (err) {
    console.error('[whatsapp] Error preparando mensaje:', err.message);
    return { enviado: false, motivo: err.message };
  }
};

/** Un vendedor envía su link de venta a un cliente por el chatbot del complejo. */
const enviarLinkDeVenta = ({ vendedor, tenant, link, destino, mensaje }) => {
  const url = linkVenta(link.codigo);
  const base = mensaje?.trim() ? `${mensaje.trim()}\n{link}` : PLANTILLA_LINK_VENTA;
  const cuerpo = aplicarPlantilla(base.includes('{link}') ? base : `${base}\n{link}`, {
    vendedor: `${vendedor.nombre} ${vendedor.apellido || ''}`.trim(), tenant: tenant.nombre, evento: link.evento ? ` para ${link.evento}` : '', link: url,
  });
  return enviarYRegistrar({ idTenant: tenant.id_tenant, tipo: 'link_venta', idLink: link.id_link, destino, cuerpo, link: url });
};

/** Mensaje de prueba de la integración (panel del superadmin). */
const enviarPrueba = (idTenant, destino) =>
  enviarYRegistrar({ idTenant, tipo: 'prueba', destino, cuerpo: '✅ Integra360: la conexión de WhatsApp de tu complejo funciona correctamente.', link: frontend() });

module.exports = { enviarEntradasPorWhatsapp, enviarLinkDeVenta, enviarPrueba, linkEntrada, linkVenta };
