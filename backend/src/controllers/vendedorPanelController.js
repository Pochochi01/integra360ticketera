const LinkVenta = require('../models/LinkVenta');
const Venta = require('../models/Venta');
const Evento = require('../models/Evento');
const { enmascarar, normalizarWhatsapp } = require('../utils/whatsapp');
const { enviarLinkDeVenta } = require('../services/notificaciones');
const chatbot = require('../services/chatbot');
const { crearLinkCheckout, urlCheckout } = require('../services/linksCheckout');
const { metodosVendedor } = require('../services/pagosService');
const SalesLink = require('../models/SalesLink');
const { correosDeVentas, enviarEntradasPorCorreo } = require('../services/correo');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { crearSalesLink, conUrl: salesLinkConUrl } = require('../services/salesLinks');

const LIMITE_POR_MINUTO = 20;
const envios = new Map(); // id_vendedor → timestamps de envíos recientes
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * Panel del vendedor (punto de venta). req.vendedor y req.tenant los cargan los middlewares
 * soloVendedor, así que todo queda limitado a su propia ficha.
 */

const urlLink = (codigo) => `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/v/${codigo}`;
const conUrl = (l) => ({ ...l, url: urlLink(l.codigo), checkout_url: urlCheckout(l.codigo) });

exports.perfil = asyncHandler(async (req, res) => {
  const { id_usuario, ...vendedor } = req.vendedor;
  res.json({
    ...vendedor,
    tenant: { id_tenant: req.tenant.id_tenant, nombre: req.tenant.nombre, slug: req.tenant.slug },
    whatsapp: vendedor.whatsapp,
    chatbot: await chatbot.disponible(req.tenant.id_tenant),
    // Medios con los que puede generar links de pago (según la configuración del complejo)
    medios_pago: await metodosVendedor(req.tenant),
  });
});

exports.links = asyncHandler(async (req, res) => res.json((await LinkVenta.findByVendedor(req.vendedor.id_vendedor)).map(conUrl)));

/**
 * POST /vendedor/links { id_evento?, id_tipo?, cantidad?, descripcion? } — genera un link único (general,
 * de un evento o de un producto concreto). Sirve como link de venta (/v/:codigo) y de checkout (/checkout/:codigo).
 */
exports.crearLink = asyncHandler(async (req, res) => {
  const link = await crearLinkCheckout({ tenant: req.tenant, vendedor: req.vendedor, ...req.body });
  res.status(201).json(conUrl(link));
});

/** PATCH /vendedor/links/:id { activo } — pausa o reactiva un link propio. */
exports.actualizarLink = asyncHandler(async (req, res) => {
  const link = await LinkVenta.findById(req.params.id);
  if (!link || link.id_vendedor !== req.vendedor.id_vendedor) throw new AppError(404, 'Link no encontrado');
  await LinkVenta.setActivo(link.id_link, !!req.body.activo);
  res.json(conUrl(await LinkVenta.findById(link.id_link)));
});

/**
 * POST /vendedor/links/:id/enviar { whatsapp, mensaje? } — envía el link a un cliente por el chatbot
 * del complejo (Meta o Baileys, según lo configurado por el superadmin).
 */
exports.enviarLink = asyncHandler(async (req, res) => {
  const link = await LinkVenta.findById(req.params.id);
  if (!link || link.id_vendedor !== req.vendedor.id_vendedor) throw new AppError(404, 'Link no encontrado');
  if (!link.activo) throw new AppError(409, 'El link está pausado');
  const destino = normalizarWhatsapp(req.body.whatsapp, process.env.WHATSAPP_PAIS_DEFECTO || 'AR');
  if (!destino) throw new AppError(400, 'Número de WhatsApp inválido (debe ser un celular, ej. +54 9 11 2345 6789)');
  if (req.body.mensaje && String(req.body.mensaje).length > 500) throw new AppError(400, 'El mensaje es demasiado largo (máx. 500)');

  // Límite anti-spam por vendedor
  const ahora = Date.now();
  const recientes = (envios.get(req.vendedor.id_vendedor) || []).filter((t) => ahora - t < 60_000);
  if (recientes.length >= LIMITE_POR_MINUTO) throw new AppError(429, `Máximo ${LIMITE_POR_MINUTO} envíos por minuto`);
  envios.set(req.vendedor.id_vendedor, [...recientes, ahora]);

  // Con Baileys se puede verificar que el número tenga WhatsApp antes de enviar
  if (req.chatbot.provider === 'baileys' && (await chatbot.baileys.existeEnWhatsapp(req.tenant.id_tenant, destino)) === false) {
    throw new AppError(400, 'Ese número no tiene una cuenta de WhatsApp');
  }
  const r = await enviarLinkDeVenta({ vendedor: req.vendedor, tenant: req.tenant, link, destino, mensaje: req.body.mensaje });
  if (!r.enviado) throw new AppError(502, `No se pudo enviar: ${r.motivo}`);
  res.json({ mensaje: `Link enviado a ${destino}`, provider: r.provider });
});

/** Estado del pago como lo informa MercadoPago (mismo criterio que las vistas reservations / sales_link_tickets). */
const estadoPago = (v) => {
  if (v.estado === 'pagado') return 'approved';
  if (v.estado === 'reembolsado') return 'refunded';
  if (v.estado === 'cancelado') return 'cancelled';
  return v.estado_ultimo_pago === 'rechazado' ? 'rejected' : 'pending';
};
const ESTADOS_PAGO = ['approved', 'pending', 'rejected', 'cancelled', 'refunded'];

/**
 * Ventas atribuidas al vendedor (links de venta, links de pago y links reutilizables).
 * ?estado_pago=approved|pending|rejected filtra por el estado del pago. El teléfono del comprador va completo
 * (whatsapp) para que el vendedor pueda contactarlo: son sus propios clientes; la versión enmascarada queda
 * en whatsapp_oculto para mostrar en pantalla.
 */
exports.ventas = asyncHandler(async (req, res) => {
  const filtro = req.query.estado_pago;
  if (filtro && !ESTADOS_PAGO.includes(filtro)) throw new AppError(400, `estado_pago inválido (${ESTADOS_PAGO.join(' | ')})`);
  const ventas = await Venta.findAll({ id_tenant: req.tenant.id_tenant, id_vendedor: req.vendedor.id_vendedor, estado: req.query.estado });
  res.json(await correosDeVentas(
    ventas.filter((v) => !filtro || estadoPago(v) === filtro).map((v) => ({
      id_venta: v.id_venta,
      fecha_venta: v.fecha_venta,
      evento: v.evento,
      comprador: v.comprador,
      whatsapp: v.whatsapp_contacto,
      whatsapp_oculto: enmascarar(v.whatsapp_contacto),
      estado_pago: estadoPago(v),
      cantidad_tickets: v.cantidad_tickets,
      monto_total: v.monto_total,
      estado: v.estado,
      metodo_pago: v.metodo_pago,
      codigo_link: v.codigo_link,
    }))
  ));
});

// ---------- Links reutilizables (/venta/:linkId) — misma lógica que los del admin, con el vendedor como dueño ----------

/** POST /api/vendedor/sales-links { id_tipo, stock_total, reutilizable?, producto? } (precio = el del tipo). */
exports.crearSalesLink = asyncHandler(async (req, res) => {
  if (req.body.tenant_id !== undefined && Number(req.body.tenant_id) !== req.tenant.id_tenant) throw new AppError(403, 'El complejo no corresponde a tu sesión');
  if (req.body.seller_id !== undefined && Number(req.body.seller_id) !== req.vendedor.id_vendedor) throw new AppError(403, 'El vendedor no corresponde a tu sesión');
  const { id_tipo, stock_total, reutilizable, producto } = req.body;
  const link = await crearSalesLink({ tenant: req.tenant, usuario: req.usuario, vendedor: req.vendedor, id_tipo, stock_total, reutilizable, producto });
  const cuenta = await MercadoPagoToken.publica(req.tenant.id_tenant);
  res.status(201).json({
    ...link, mensaje: 'Link reutilizable generado',
    aviso: cuenta?.conectado && cuenta.activo ? link.aviso : 'El complejo no tiene MercadoPago conectado: el link no va a poder cobrar hasta que el administrador lo conecte',
  });
});

exports.salesLinks = asyncHandler(async (req, res) => res.json((await SalesLink.findByVendedor(req.vendedor.id_vendedor)).map(salesLinkConUrl)));

exports.actualizarSalesLink = asyncHandler(async (req, res) => {
  const [r] = await SalesLink.setActivo(req.params.id, req.tenant.id_tenant, Boolean(req.body.activo), req.vendedor.id_vendedor);
  if (!r.affectedRows) throw new AppError(404, 'Link no encontrado');
  res.json(salesLinkConUrl(await SalesLink.findById(req.params.id)));
});

exports.ticketsSalesLink = asyncHandler(async (req, res) => res.json(await SalesLink.tickets(req.params.id, req.tenant.id_tenant, req.vendedor.id_vendedor)));

/** POST /api/vendedor/ventas/:id/reenviar-correo — sólo ventas propias del vendedor. */
exports.reenviarCorreo = asyncHandler(async (req, res) => {
  const venta = await Venta.findById(Number(req.params.id));
  if (!venta || venta.id_tenant !== req.tenant.id_tenant || venta.id_vendedor !== req.vendedor.id_vendedor) throw new AppError(404, 'Venta no encontrada');
  res.json(await enviarEntradasPorCorreo(venta.id_venta));
});

exports.eventos = asyncHandler(async (req, res) => res.json(await Evento.findAll({ id_tenant: req.tenant.id_tenant })));
