/**
 * Mensajes de WhatsApp con los links de descarga de las entradas (uno por ticket, cada uno con su QR único).
 * Los usan el admin (/admin/ventas, /admin/eventos) y el vendedor (Mis ventas): todos envían el mismo texto.
 */
export const TEXTO_ESTANDAR = 'Gracias por tu compra, aquí tienes tus entradas.';

/**
 * Texto del mensaje.
 * nombre: del comprador (se usa el primer nombre) · evento: opcional · tickets: [{ numero, tipo?, link }]
 */
export const mensajeEntradas = ({ nombre, evento, tickets }) => {
  const primerNombre = String(nombre || '').trim().split(/\s+/)[0];
  return [
    `¡Hola${primerNombre ? ` ${primerNombre}` : ''}! ${TEXTO_ESTANDAR}`,
    ...(evento ? [`🎉 ${evento}`] : []),
    '',
    ...tickets.map((t) => `🎟️ Entrada ${t.numero}${t.tipo ? ` (${t.tipo})` : ''}: ${t.link}`),
    '',
    'Cada entrada tiene su QR único: presentalo en la puerta.',
  ].join('\n');
};

/** https://wa.me/<teléfono sin + ni separadores>?text=<mensaje>; null si no hay teléfono. */
export const urlWhatsapp = (telefono, texto) => {
  const numero = String(telefono || '').replace(/\D/g, '');
  if (!numero) return null;
  return texto ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : `https://wa.me/${numero}`;
};

/** Para filas que ya traen tickets_links ({ numero, tipo, url }) — paneles de correos y del vendedor. */
export const textoEntradas = (venta, evento) =>
  mensajeEntradas({ nombre: venta.comprador, evento: evento || venta.evento, tickets: (venta.tickets_links || []).map((t) => ({ ...t, link: t.url })) });

export const urlWhatsappEntradas = (venta, evento) =>
  urlWhatsapp(venta.whatsapp, venta.tickets_links?.length ? textoEntradas(venta, evento) : null);

/** Estado del correo → texto y color del badge. */
export const ESTADO_CORREO = {
  sent: { texto: 'Correo enviado', estado: 'pagado' },
  pending: { texto: 'Enviando correo', estado: 'pendiente' },
  failed: { texto: 'Correo fallido', estado: 'cancelado' },
};
