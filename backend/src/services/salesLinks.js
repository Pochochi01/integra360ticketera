const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const SalesLink = require('../models/SalesLink');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { AppError } = require('../utils/errors');

/**
 * Links de venta del administrador del complejo: https://<frontend>/venta/:linkId (sales_links.id).
 *
 * Se comparten en redes. Cada link vende un tipo de entrada a un precio propio y tiene stock propio:
 *  - reutilizable: muchas compras hasta agotar el stock
 *  - único: una sola venta aprobada (de stock_total entradas) y queda agotado
 * El stock del link se descuenta SOLO cuando MercadoPago aprueba el pago (pagosService.procesarPagoMercadoPago).
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const urlVenta = (id) => `${frontend()}/venta/${id}`;

const conUrl = (l) => l && { ...l, precio: Number(l.precio), reutilizable: Boolean(l.reutilizable), activo: Boolean(l.activo), url: urlVenta(l.id) };

/** Un link se puede comprar si está activo, tiene stock y el link único todavía no se vendió. */
const disponible = (l) => Boolean(l.activo) && l.stock_disponible > 0;

/** Valida y crea el link. El tipo de entrada debe ser de un evento del complejo y estar a la venta. */
const crearSalesLink = async ({ tenant, usuario, id_tipo, producto, precio, stock_total, reutilizable }) => {
  const tipo = id_tipo ? await TipoTicket.findById(Number(id_tipo)) : null;
  if (!tipo) throw new AppError(400, 'Elegí el tipo de entrada que vende el link');
  const evento = await Evento.findById(tipo.id_evento);
  if (!evento || evento.id_tenant !== tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
  if (!['publicado', 'agotado'].includes(evento.estado)) throw new AppError(409, 'El evento no está a la venta');
  if (!tipo.activo || tipo.solo_admin) throw new AppError(409, `El tipo "${tipo.nombre_tipo}" no está a la venta`);

  const stock = Number(stock_total);
  if (!Number.isInteger(stock) || stock < 1 || stock > 100000) throw new AppError(400, 'El stock debe ser un entero entre 1 y 100000');
  const reutil = reutilizable === undefined ? true : reutilizable === true || reutilizable === 'true' || reutilizable === 1;
  // Link único: una compra de stock_total entradas (tope razonable para una sola persona)
  if (!reutil && stock > 50) throw new AppError(400, 'Un link único vende como máximo 50 entradas');
  const monto = precio === undefined || precio === null || precio === '' ? Number(tipo.precio) : Number(precio);
  if (!(monto > 0) || monto > 10_000_000) throw new AppError(400, 'El precio debe ser mayor a 0');
  const nombre = String(producto || `${evento.nombre} · ${tipo.nombre_tipo}`).trim().slice(0, 120);

  const id = await SalesLink.create({
    tenant_id: tenant.id_tenant, id_tipo: tipo.id_tipo, producto: nombre, precio: Math.round(monto * 100) / 100,
    stock_total: stock, reutilizable: reutil, creado_por: usuario.id_usuario,
  });
  return conUrl(await SalesLink.findById(id));
};

/** Datos públicos de /venta/:linkId: complejo, producto, stock y si se puede pagar con MercadoPago. */
const datosVenta = async (id) => {
  const link = await SalesLink.findById(String(id));
  if (!link) throw new AppError(404, 'Este link de venta no existe');
  const [[t]] = await pool.query(
    'SELECT nombre, slug, direccion, telefono, email_contacto, logo_url, color_primario, estado FROM tenants WHERE id_tenant = ?', [link.tenant_id]
  );
  if (t.estado !== 'activo') throw new AppError(404, 'Este link de venta no está disponible');
  const evento = await Evento.findById(link.id_evento);
  const cuenta = await MercadoPagoToken.publica(link.tenant_id);
  const vendible = disponible(link) && evento.estado === 'publicado' && new Date(evento.fecha) > new Date();
  return {
    link_id: link.id,
    producto: link.producto,
    precio: Number(link.precio),
    reutilizable: Boolean(link.reutilizable),
    stock_disponible: link.stock_disponible,
    // Link único: la compra es por todo el stock; reutilizable: el comprador elige, hasta 50 por compra
    cantidad_fija: link.reutilizable ? null : link.stock_total,
    cantidad_maxima: link.reutilizable ? Math.min(link.stock_disponible, evento.limite_por_persona || 50, 50) : link.stock_total,
    disponible: vendible,
    motivo: vendible ? null : !link.activo ? 'pausado' : link.stock_disponible <= 0 ? (link.reutilizable ? 'agotado' : 'usado') : 'evento',
    evento: { id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar, imagen_evento: evento.imagen_evento, tipo: link.tipo },
    complejo: { nombre: t.nombre, slug: t.slug, direccion: t.direccion, telefono: t.telefono, email: t.email_contacto, logo_url: t.logo_url, color: t.color_primario },
    mercadopago_disponible: Boolean(cuenta?.conectado && cuenta.activo),
  };
};

module.exports = { crearSalesLink, datosVenta, disponible, urlVenta, conUrl };
