const LinkVenta = require('../models/LinkVenta');
const Venta = require('../models/Venta');
const Evento = require('../models/Evento');
const { enmascarar, normalizarWhatsapp } = require('../utils/whatsapp');
const { enviarLinkDeVenta } = require('../services/notificaciones');
const chatbot = require('../services/chatbot');
const { metodosVendedor } = require('../services/pagosService');

const LIMITE_POR_MINUTO = 20;
const envios = new Map(); // id_vendedor → timestamps de envíos recientes
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * Panel del vendedor (punto de venta). req.vendedor y req.tenant los cargan los middlewares
 * soloVendedor, así que todo queda limitado a su propia ficha.
 */

const urlLink = (codigo) => `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/v/${codigo}`;
const conUrl = (l) => ({ ...l, url: urlLink(l.codigo) });

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

/** POST /vendedor/links { id_evento?, descripcion? } — genera un link único (general o de un evento del tenant). */
exports.crearLink = asyncHandler(async (req, res) => {
  const idEvento = req.body.id_evento ? Number(req.body.id_evento) : null;
  if (idEvento) {
    const evento = await Evento.findById(idEvento);
    if (!evento || evento.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
    if (!['publicado', 'agotado'].includes(evento.estado)) throw new AppError(409, 'El evento no está a la venta');
  }
  const descripcion = req.body.descripcion?.trim().slice(0, 120) || null;
  const id = await LinkVenta.create({ id_vendedor: req.vendedor.id_vendedor, id_evento: idEvento, descripcion });
  res.status(201).json(conUrl(await LinkVenta.findById(id)));
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

/** Ventas atribuidas al vendedor. Los datos del comprador se muestran parcialmente. */
exports.ventas = asyncHandler(async (req, res) => {
  const ventas = await Venta.findAll({ id_tenant: req.tenant.id_tenant, id_vendedor: req.vendedor.id_vendedor, estado: req.query.estado });
  res.json(
    ventas.map((v) => ({
      id_venta: v.id_venta,
      fecha_venta: v.fecha_venta,
      evento: v.evento,
      comprador: v.comprador,
      whatsapp: enmascarar(v.whatsapp_contacto),
      cantidad_tickets: v.cantidad_tickets,
      monto_total: v.monto_total,
      estado: v.estado,
      metodo_pago: v.metodo_pago,
      codigo_link: v.codigo_link,
    }))
  );
});

exports.eventos = asyncHandler(async (req, res) => res.json(await Evento.findAll({ id_tenant: req.tenant.id_tenant })));
