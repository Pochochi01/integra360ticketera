const LinkVenta = require('../models/LinkVenta');
const Venta = require('../models/Venta');
const Ticket = require('../models/Ticket');
const Tenant = require('../models/Tenant');
const { generarImagenTicket } = require('../services/ticketImagen');
const { AppError, asyncHandler } = require('../utils/errors');

const fechaLarga = (f) => new Date(String(f).replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });

/** PNG de la entrada (imagen del evento + QR). Compartido con /tickets/:id/imagen. */
const enviarImagenTicket = async (res, ticket, { tenant, color, indice, total }) => {
  const png = await generarImagenTicket({
    codigo: ticket.codigo_qr, evento: ticket.evento, fecha: fechaLarga(ticket.fecha_evento), lugar: ticket.lugar,
    tipo: ticket.nombre_tipo, asiento: ticket.asiento, titular: ticket.titular, tenant, imagen: ticket.imagen_evento,
    color: color || undefined, indice, total,
  });
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="entrada-${ticket.id_ticket}.png"` });
  res.send(png);
};
exports.enviarImagenTicket = enviarImagenTicket;

/**
 * GET /publico/links/:codigo — resuelve un link de vendedor (sin login).
 * Suma una visita y devuelve a qué tenant/evento lleva y el nombre del vendedor.
 */
exports.resolverLink = asyncHandler(async (req, res) => {
  const link = await LinkVenta.findByCodigo(req.params.codigo);
  if (!link || !link.activo || link.estado_vendedor !== 'activo' || link.estado_tenant !== 'activo') {
    throw new AppError(404, 'Link de venta inválido o desactivado');
  }
  await LinkVenta.registrarVisita(link.id_link);
  res.json({
    codigo: link.codigo,
    vendedor: `${link.vendedor_nombre} ${link.vendedor_apellido || ''}`.trim(),
    tenant: { id_tenant: link.id_tenant, nombre: link.tenant, slug: link.tenant_slug },
    id_evento: link.id_evento,
    evento: link.evento,
    imagen_evento: link.imagen_evento,
  });
});

/** Venta por token + tickets que siguen siendo del comprador (los transferidos ya no se muestran). */
const ventaPorToken = async (token) => {
  if (!/^[a-f0-9]{40}$/.test(token)) throw new AppError(404, 'Entradas no encontradas');
  const venta = await Venta.findByToken(token);
  if (!venta) throw new AppError(404, 'Entradas no encontradas');
  const tickets = (await Ticket.findByVenta(venta.id_venta)).filter((t) => t.id_usuario === venta.id_usuario);
  return { venta, tickets };
};

/**
 * GET /publico/entradas/:token — página pública de las entradas de una venta (link enviado por WhatsApp).
 * El token es secreto (160 bits). Cada ticket válido trae la URL de su imagen (evento + QR).
 */
exports.entradas = asyncHandler(async (req, res) => {
  const { venta, tickets } = await ventaPorToken(req.params.token);
  res.json({
    id_venta: venta.id_venta,
    estado: venta.estado,
    tenant: venta.tenant,
    evento: venta.evento,
    fecha_evento: venta.fecha_evento,
    imagen_evento: venta.imagen_evento,
    comprador: venta.comprador,
    tickets: tickets.map((t) => ({
      id_ticket: t.id_ticket,
      nombre_tipo: t.nombre_tipo,
      asiento: t.asiento,
      lugar: t.lugar,
      estado: t.estado,
      codigo_qr: t.estado === 'valido' ? t.codigo_qr : null,
      imagen_url: t.estado === 'valido' ? `/api/publico/entradas/${req.params.token}/tickets/${t.id_ticket}.png` : null,
    })),
  });
});

/** GET /publico/entradas/:token/tickets/:idTicket.png — imagen compuesta de una entrada válida. */
exports.imagenEntrada = asyncHandler(async (req, res) => {
  const { venta, tickets } = await ventaPorToken(req.params.token);
  const idx = tickets.findIndex((t) => t.id_ticket === Number(req.params.idTicket));
  if (idx < 0 || tickets[idx].estado !== 'valido') throw new AppError(404, 'Entrada no disponible');
  const tenant = await Tenant.findById(venta.id_tenant);
  await enviarImagenTicket(res, tickets[idx], { tenant: venta.tenant, color: tenant.config.color_primario, indice: idx + 1, total: tickets.length });
});
