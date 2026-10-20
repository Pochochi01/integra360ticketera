const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const Usuario = require('../models/Usuario');
const Venta = require('../models/Venta');
const Pago = require('../models/Pago');
const pagos = require('../services/pagosService');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { ejecutarVenta, liberarVenta } = require('./ventasController');
const { normalizarWhatsapp } = require('../utils/whatsapp');
const { AppError, asyncHandler } = require('../utils/errors');

/**
 * Links de pago que genera un VENDEDOR para un comprador concreto.
 *
 * POST /api/links/generar
 *   { tipo_pago?: 'mercadopago' | 'efectivo', id_evento, items: [{ id_tipo, cantidad, asientos? }],
 *     comprador: { nombre, apellido?, whatsapp, email? }, tenant_id?, seller_id? }
 *
 *  - mercadopago (por defecto): reserva las entradas y crea la preferencia de Checkout Pro con el
 *    access token OAuth DEL COMPLEJO → devuelve el init_point. El dinero se acredita en su cuenta.
 *  - efectivo (sólo si el admin lo habilitó): reserva las entradas como "pendiente de pago en efectivo"
 *    y devuelve el link interno de la reserva. Los tickets quedan con validado = false (estado
 *    'pendiente') hasta que el admin confirme el cobro; la Portería los rechaza mientras tanto.
 *
 * tenant_id y seller_id salen SIEMPRE de la sesión (JWT); si se envían deben coincidir.
 */
const horas = (nombre, defecto) => Number(process.env[nombre] || defecto) * 3600 * 1000;
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const TIPOS = ['mercadopago', 'efectivo'];

/** No se confía en tenant_id / seller_id del cuerpo: si vienen, tienen que ser los de la sesión. */
exports.verificarAlcance = (req, _res, next) => {
  const { tenant_id, seller_id } = req.body;
  if (tenant_id !== undefined && Number(tenant_id) !== req.tenant.id_tenant) return next(new AppError(403, 'El complejo no corresponde a tu sesión'));
  if (seller_id !== undefined && Number(seller_id) !== req.vendedor.id_vendedor) return next(new AppError(403, 'El vendedor no corresponde a tu sesión'));
  const tipo = req.body.tipo_pago || 'mercadopago';
  if (!TIPOS.includes(tipo)) return next(new AppError(400, 'tipo_pago inválido (mercadopago | efectivo)'));
  req.body.tipo_pago = tipo;
  req.body.metodo_pago = tipo; // lo usa validarCompra
  next();
};

/**
 * Identifica (o da de alta) al comprador por su WhatsApp. Los compradores creados así no tienen
 * contraseña utilizable: acceden a sus entradas con el link privado de la compra (/entrada/:token).
 */
exports.resolverComprador = asyncHandler(async (req, _res, next) => {
  const c = req.body.comprador || {};
  const nombre = String(c.nombre || '').trim();
  if (!nombre) throw new AppError(400, 'El nombre del comprador es obligatorio');
  if (nombre.length > 80) throw new AppError(400, 'El nombre es demasiado largo');
  const whatsapp = normalizarWhatsapp(c.whatsapp, process.env.WHATSAPP_PAIS_DEFECTO || 'AR');
  if (!whatsapp) throw new AppError(400, 'WhatsApp del comprador inválido (debe ser un celular, ej. +54 9 11 2345 6789)');
  const email = c.email ? String(c.email).trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'Email del comprador inválido');

  let usuario = email ? await Usuario.findByEmail(email) : null;
  if (usuario && usuario.rol !== 'comprador') throw new AppError(409, 'Ese email pertenece a una cuenta del personal');
  if (!usuario) {
    const [[porWhatsapp]] = await pool.query("SELECT id_usuario FROM usuarios WHERE whatsapp = ? AND rol = 'comprador' ORDER BY id_usuario LIMIT 1", [whatsapp]);
    usuario = porWhatsapp;
  }
  if (!usuario) {
    const id = await Usuario.create({
      nombre, apellido: c.apellido?.trim() || null, email, whatsapp, rol: 'comprador',
      password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
    });
    usuario = { id_usuario: id };
  }
  req.body.id_usuario_destino = usuario.id_usuario;
  req.body.whatsapp = whatsapp;
  next();
});

/** POST /api/links/generar (después de verificarAlcance → resolverComprador → validarCompra('vendedor')) */
exports.generar = asyncHandler(async (req, res) => {
  const tipo = req.body.tipo_pago;
  const evento = req.compra.evento;
  // Reserva: MercadoPago 24 h (el comprador recibe el link y paga después); efectivo 72 h.
  // Nunca más allá del inicio del evento.
  const vence = Math.min(Date.now() + (tipo === 'efectivo' ? horas('EFECTIVO_RESERVA_HORAS', 72) : horas('LINK_MP_RESERVA_HORAS', 24)), new Date(evento.fecha).getTime());
  const { venta, tickets } = await ejecutarVenta(req.compra, { expiraEn: new Date(vence) });

  // Sin costo (todas las entradas a $0): ya quedan emitidas y validadas
  if (venta.estado === 'pagado') {
    return res.status(201).json({ tipo_pago: 'cortesia', url: `${frontend()}/entrada/${venta.token_acceso}`, mensaje: 'Entradas sin cargo emitidas', venta: resumen(venta), tickets: ticketsDe(tickets) });
  }

  if (tipo === 'mercadopago') {
    let pref;
    try {
      pref = await pagos.preferenciaDeVenta(venta, tickets);
    } catch (e) {
      // Si MercadoPago falla, se libera la reserva para no retener stock sin link de pago
      await pool.withTransaction(async (conn) => liberarVenta(conn, await Venta.lockById(venta.id_venta, conn), 'cancelado'));
      throw e.status ? e : new AppError(502, `MercadoPago no pudo generar el link: ${e.message}`);
    }
    // Cuenta conectada con credenciales de prueba → checkout sandbox
    const cuenta = await MercadoPagoToken.publica(venta.id_tenant);
    const url = cuenta && !cuenta.live_mode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
    return res.status(201).json({
      tipo_pago: 'mercadopago', url, init_point: pref.init_point, mensaje: 'Link de MercadoPago generado',
      venta: resumen(await Venta.findById(venta.id_venta)), tickets: ticketsDe(tickets),
    });
  }

  // Efectivo: el pago queda pendiente hasta que el admin lo valide
  await Pago.create({ id_venta: venta.id_venta, proveedor: 'efectivo', monto: venta.monto_total, detalle: `Vendedor #${req.vendedor.id_vendedor}` });
  res.status(201).json({
    tipo_pago: 'efectivo', url: `${frontend()}/entrada/${venta.token_acceso}`,
    mensaje: 'Link de pago en efectivo generado (pendiente de validación)',
    venta: resumen(await Venta.findById(venta.id_venta)), tickets: ticketsDe(tickets),
  });
});

const resumen = (v) => ({
  id_venta: v.id_venta, estado: v.estado, tipo_pago: v.metodo_pago, monto_total: v.monto_total,
  evento: v.evento, comprador: v.comprador, whatsapp: v.whatsapp_contacto, expira_en: v.expira_en,
});
const ticketsDe = (tickets) => tickets.map((t) => ({ id_ticket: t.id_ticket, nombre_tipo: t.nombre_tipo, estado: t.estado, validado: ['valido', 'usado'].includes(t.estado) }));

/** GET /api/links — links de pago generados por el vendedor (sus reservas) con su estado. */
exports.listar = asyncHandler(async (req, res) => {
  const ventas = (await Venta.findAll({ id_tenant: req.tenant.id_tenant, id_vendedor: req.vendedor.id_vendedor })).filter((v) => v.expira_en || v.metodo_pago === 'efectivo');
  const lista = [];
  for (const v of ventas) {
    let url = `${frontend()}/entrada/${v.token_acceso}`;
    if (v.metodo_pago === 'mercadopago' && v.estado === 'pendiente') {
      const pago = await Pago.pendienteDeVenta(v.id_venta, 'mercadopago');
      try { url = JSON.parse(pago?.detalle || '{}').init_point || null; } catch { url = null; }
    }
    lista.push({ ...resumen(v), url, fecha_venta: v.fecha_venta });
  }
  res.json(lista);
});
