const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const SalesLink = require('../models/SalesLink');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { AppError } = require('../utils/errors');

/**
 * Links de venta reutilizables: https://<frontend>/venta/:linkId (sales_links.id). Los genera el admin del
 * complejo (seller_id NULL) o un vendedor (seller_id = su id_vendedor: cada venta queda atribuida a él).
 *
 * Se comparten en redes. Cada link vende un tipo de entrada a un precio propio y tiene stock propio:
 *  - reutilizable: muchas compras hasta agotar el stock
 *  - único: una sola venta aprobada (de stock_total entradas) y queda agotado
 * El stock del link se descuenta SOLO cuando MercadoPago aprueba el pago (pagosService.procesarPagoMercadoPago).
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const urlVenta = (id) => `${frontend()}/venta/${id}`;

const conUrl = (l) => l && { ...l, precio: Number(l.precio), reutilizable: Boolean(l.reutilizable), activo: Boolean(l.activo), url: urlVenta(l.id), problema: problemaDelEvento(l) };

/**
 * Por qué el EVENTO no deja vender aunque el link tenga stock (null si se puede vender).
 * El link tiene su propio stock, pero cada compra también consume el stock del tipo de entrada
 * (tipos_ticket.stock_disponible). Si ese llega a 0 el evento pasa a 'agotado' solo: hay que subir el stock
 * del tipo en Eventos (el evento vuelve a 'publicado' y el MISMO link sigue funcionando) o esperar a que
 * venzan las reservas pendientes (checkouts abandonados, 30 min).
 */
const problemaDelEvento = (l) => {
  if (new Date(l.fecha_evento) <= new Date()) return 'evento_pasado';
  if (!l.tipo_activo) return 'tipo_inactivo';
  if (l.estado_evento === 'agotado' || l.stock_evento <= 0) return l.reservadas_evento > 0 ? 'evento_reservado' : 'evento_agotado';
  if (l.estado_evento !== 'publicado') return 'evento_no_publicado';
  return null;
};

/** Un link se puede comprar si está activo, tiene stock, el link único no se vendió y su vendedor (si tiene) sigue activo. */
const disponible = (l) => Boolean(l.activo) && l.stock_disponible > 0 && (!l.seller_id || l.estado_vendedor === 'activo');

/**
 * Valida y crea el link. El tipo de entrada debe ser de un evento del complejo y estar a la venta.
 * vendedor: si lo genera un vendedor, queda como dueño (seller_id) y vende al precio de lista del tipo (no puede
 * fijar un precio propio: eso queda para el admin).
 */
const crearSalesLink = async ({ tenant, usuario, vendedor = null, id_tipo, producto, precio, stock_total, reutilizable }) => {
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
  const monto = vendedor || precio === undefined || precio === null || precio === '' ? Number(tipo.precio) : Number(precio);
  if (!(monto > 0) || monto > 10_000_000) throw new AppError(400, 'El precio debe ser mayor a 0');
  // Aviso (no bloquea): el link no puede vender más de lo que queda del tipo de entrada en el evento
  const aviso = stock > tipo.stock_disponible
    ? `El tipo "${tipo.nombre_tipo}" tiene ${tipo.stock_disponible} entradas disponibles: el link va a vender como máximo esas hasta que subas el stock en Eventos`
    : null;
  const nombre = String(producto || `${evento.nombre} · ${tipo.nombre_tipo}`).trim().slice(0, 120);

  const id = await SalesLink.create({
    tenant_id: tenant.id_tenant, seller_id: vendedor?.id_vendedor || null, id_tipo: tipo.id_tipo, producto: nombre, precio: Math.round(monto * 100) / 100,
    stock_total: stock, reutilizable: reutil, creado_por: usuario.id_usuario,
  });
  return { ...conUrl(await SalesLink.findById(id)), aviso };
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
  const problema = problemaDelEvento(link);
  const vendible = disponible(link) && !problema;
  return {
    link_id: link.id,
    producto: link.producto,
    precio: Number(link.precio),
    reutilizable: Boolean(link.reutilizable),
    stock_disponible: link.stock_disponible,
    // Link único: la compra es por todo el stock; reutilizable: el comprador elige, hasta 50 por compra
    cantidad_fija: link.reutilizable ? null : link.stock_total,
    cantidad_maxima: link.reutilizable ? Math.max(1, Math.min(link.stock_disponible, link.stock_evento, evento.limite_por_persona || 50, 50)) : link.stock_total,
    disponible: vendible,
    vendedor: link.seller_id ? link.vendedor : null,
    motivo: vendible ? null : !link.activo || (link.seller_id && link.estado_vendedor !== 'activo') ? 'pausado' : link.stock_disponible <= 0 ? (link.reutilizable ? 'agotado' : 'usado') : problema,
    evento: { id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar, imagen_evento: evento.imagen_evento, tipo: link.tipo },
    complejo: { nombre: t.nombre, slug: t.slug, direccion: t.direccion, telefono: t.telefono, email: t.email_contacto, logo_url: t.logo_url, color: t.color_primario },
    mercadopago_disponible: Boolean(cuenta?.conectado && cuenta.activo),
  };
};

module.exports = { crearSalesLink, datosVenta, disponible, urlVenta, conUrl };
