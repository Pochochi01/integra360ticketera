const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const LinkVenta = require('../models/LinkVenta');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { AppError } = require('../utils/errors');

/**
 * Links de checkout de vendedores: https://<frontend>/checkout/:linkId (linkId = links_venta.codigo).
 *
 * El link identifica al vendedor (y por lo tanto a su complejo) y opcionalmente fija el producto:
 * evento, tipo de entrada y cantidad. No reserva nada: la reserva y la preferencia de MercadoPago se
 * crean cuando el comprador completa sus datos (POST /api/pagos/crear).
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const urlCheckout = (codigo) => `${frontend()}/checkout/${codigo}`;

/** Valida y crea el link. Todo debe pertenecer al complejo del vendedor. */
const crearLinkCheckout = async ({ tenant, vendedor, id_evento, id_tipo, cantidad, descripcion }) => {
  let idEvento = id_evento ? Number(id_evento) : null;
  const idTipo = id_tipo ? Number(id_tipo) : null;
  const cant = cantidad === undefined || cantidad === null || cantidad === '' ? null : Number(cantidad);
  if (cant !== null && (!Number.isInteger(cant) || cant < 1 || cant > 50)) throw new AppError(400, 'La cantidad debe ser un entero entre 1 y 50');

  if (idTipo) {
    const tipo = await TipoTicket.findById(idTipo);
    if (!tipo || (idEvento && tipo.id_evento !== idEvento)) throw new AppError(400, 'El tipo de entrada no pertenece al evento');
    if (!tipo.activo || tipo.solo_admin) throw new AppError(409, `El tipo "${tipo.nombre_tipo}" no está a la venta`);
    idEvento = tipo.id_evento; // el tipo determina el evento
  }
  if (idEvento) {
    const evento = await Evento.findById(idEvento);
    if (!evento || evento.id_tenant !== tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
    if (!['publicado', 'agotado'].includes(evento.estado)) throw new AppError(409, 'El evento no está a la venta');
  }
  const id = await LinkVenta.create({
    id_vendedor: vendedor.id_vendedor, id_evento: idEvento, id_tipo: idTipo, cantidad: cant,
    descripcion: descripcion?.trim().slice(0, 120) || null,
  });
  const link = await LinkVenta.findById(id);
  return { ...link, link_id: link.codigo, url: urlCheckout(link.codigo) };
};

/**
 * Datos públicos de la página de checkout: complejo (nombre, logo, dirección), vendedor y los eventos /
 * tipos que se pueden comprar con ese link. 404 si el link, el vendedor o el complejo no están activos.
 */
const datosCheckout = async (codigo) => {
  const link = await LinkVenta.findByCodigo(String(codigo));
  if (!link || !link.activo || link.estado_vendedor !== 'activo' || link.estado_tenant !== 'activo') {
    throw new AppError(404, 'Este link de pago no existe o fue desactivado');
  }
  await LinkVenta.registrarVisita(link.id_link);
  const [[t]] = await pool.query('SELECT nombre, slug, direccion, telefono, email_contacto, logo_url, color_primario FROM tenants WHERE id_tenant = ?', [link.id_tenant]);
  const cuenta = await MercadoPagoToken.publica(link.id_tenant);

  const [eventos] = await pool.query(
    `SELECT id_evento, nombre, descripcion, fecha, lugar, imagen_evento, limite_por_persona, tiene_seating
       FROM eventos WHERE id_tenant = ? AND estado = 'publicado' AND fecha > NOW() ${link.id_evento ? 'AND id_evento = ?' : ''}
      ORDER BY fecha`,
    link.id_evento ? [link.id_tenant, link.id_evento] : [link.id_tenant]
  );
  const ahora = new Date();
  for (const e of eventos) {
    e.tipos = (await TipoTicket.findByEvento(e.id_evento))
      .filter((tp) => (!link.id_tipo || tp.id_tipo === link.id_tipo)
        && (!tp.venta_desde || new Date(tp.venta_desde) <= ahora) && (!tp.venta_hasta || new Date(tp.venta_hasta) >= ahora))
      .map((tp) => ({ id_tipo: tp.id_tipo, nombre_tipo: tp.nombre_tipo, condiciones: tp.condiciones, precio: Number(tp.precio), stock_disponible: tp.stock_disponible }));
  }

  return {
    link_id: link.codigo,
    descripcion: link.descripcion,
    vendedor: `${link.vendedor_nombre} ${link.vendedor_apellido || ''}`.trim(),
    producto: { id_evento: link.id_evento, id_tipo: link.id_tipo, cantidad: link.cantidad },
    complejo: { nombre: t.nombre, slug: t.slug, direccion: t.direccion, telefono: t.telefono, email: t.email_contacto, logo_url: t.logo_url, color: t.color_primario },
    mercadopago_disponible: Boolean(cuenta?.conectado && cuenta.activo),
    // Eventos con asientos numerados se compran desde la web del complejo (hay que elegir butaca)
    eventos: eventos.filter((e) => !e.tiene_seating && e.tipos.length),
  };
};

module.exports = { crearLinkCheckout, datosCheckout, urlCheckout };
