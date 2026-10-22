/**
 * Link de WhatsApp al comprador con los links de descarga de sus entradas (uno por ticket), para enviarlos a
 * mano cuando el correo falló o como recordatorio. Abre el chat en el dispositivo del admin o del vendedor.
 * venta: { comprador, evento?, whatsapp, tickets_links: [{ numero, tipo, url }] }
 */
export const textoEntradas = (venta, evento) => {
  const links = (venta.tickets_links || []).map((t) => `🎟️ Entrada ${t.numero}${t.tipo ? ` (${t.tipo})` : ''}: ${t.url}`);
  return [`¡Hola ${venta.comprador?.split(' ')[0] || ''}! Estas son tus entradas${evento || venta.evento ? ` para ${evento || venta.evento}` : ''}:`, ...links, 'Cada una tiene su QR único: presentalo en la puerta.'].join('\n');
};

/** https://wa.me/<teléfono sin + ni separadores>[?text=…] */
export const urlWhatsappEntradas = (venta, evento) => {
  const numero = String(venta.whatsapp || '').replace(/\D/g, '');
  if (!numero) return null;
  return venta.tickets_links?.length ? `https://wa.me/${numero}?text=${encodeURIComponent(textoEntradas(venta, evento))}` : `https://wa.me/${numero}`;
};

/** Estado del correo → texto y color del badge. */
export const ESTADO_CORREO = {
  sent: { texto: 'Correo enviado', estado: 'pagado' },
  pending: { texto: 'Enviando correo', estado: 'pendiente' },
  failed: { texto: 'Correo fallido', estado: 'cancelado' },
};
