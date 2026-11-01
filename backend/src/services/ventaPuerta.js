const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const Usuario = require('../models/Usuario');
const Venta = require('../models/Venta');
const pagos = require('./pagosService');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { ticketsConLink } = require('./correo');
const { AppError } = require('../utils/errors');

/**
 * Venta en portería digital. No hay un flujo de pago nuevo: todo pasa por el mismo núcleo que el resto de los
 * canales (validarCompra → ejecutarVenta → preferencia con el token del complejo → webhook → confirmarStockDeVenta
 * → tickets habilitados + correo/WhatsApp). Acá sólo vive lo propio de la puerta:
 *
 *  - Compra por QR (/comprar/evento/:id, /comprar/:id/:tipo): datos para la landing de compra rápida. El pago lo
 *    hace POST /api/ventas/checkout con { event_id, origen: 'puerta_qr' }.
 *  - Cobro asistido en boletería (/admin/porteros/venta), con dos medios:
 *      · mercadopago: el staff genera el cobro y muestra el QR de pago; el cliente paga desde su celular y la
 *        pantalla confirma sola (consulta el estado cada 2 s). El stock baja cuando MercadoPago aprueba.
 *      · efectivo: el staff cobra en mano y registra la venta al instante, sin tocar MercadoPago: venta pagada,
 *        stock descontado y entradas habilitadas en una sola transacción (registrarVentaEfectivo).
 *    Ambos: misma validación de stock (validarCompra('puerta') + filas bloqueadas en ejecutarVenta), quién la
 *    registró (ventas.id_usuario_staff), observaciones, auditoría en la misma transacción y una clave de
 *    idempotencia por operación (un doble click o un reintento no registra dos ventas).
 */
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Slug de un tipo de entrada para la URL: «Early Bird» → earlybird, «Last Chance» → lastchance. */
const slugTipo = (nombre) => String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const urlCompra = (idEvento, tipo = null) => (tipo ? `${frontend()}/comprar/${idEvento}/${slugTipo(tipo.nombre_tipo)}` : `${frontend()}/comprar/evento/${idEvento}`);

/** Tipos que se pueden comprar ahora mismo (activos, no administrativos, dentro de su ventana de venta). */
const tiposVendibles = async (idEvento) => {
  const ahora = new Date();
  return (await TipoTicket.findByEvento(idEvento)).filter((t) =>
    (!t.venta_desde || new Date(t.venta_desde) <= ahora) && (!t.venta_hasta || new Date(t.venta_hasta) >= ahora));
};

/**
 * GET /api/publico/comprar/:idEvento[/:tipo] — datos de la landing. Con :tipo devuelve sólo ese tipo (compra en
 * un paso). La disponibilidad se informa como estado (disponible / últimas N / agotado), no como stock exacto.
 */
const datosCompraRapida = async (idEvento, slug = null) => {
  const evento = await Evento.findById(Number(idEvento));
  if (!evento || evento.estado_tenant !== 'activo') throw new AppError(404, 'Evento no encontrado');
  const [[t]] = await pool.query('SELECT nombre, logo_url, color_primario, direccion FROM tenants WHERE id_tenant = ?', [evento.id_tenant]);
  let tipos = await tiposVendibles(evento.id_evento);
  if (slug) {
    tipos = tipos.filter((tp) => slugTipo(tp.nombre_tipo) === String(slug).toLowerCase());
    if (!tipos.length) throw new AppError(404, 'Ese tipo de entrada no está a la venta');
  }
  const cuenta = await MercadoPagoToken.publica(evento.id_tenant);
  const vendible = evento.estado === 'publicado' && new Date(String(evento.fecha).replace(' ', 'T')) > new Date(Date.now() - 6 * 3600 * 1000);
  return {
    evento: {
      id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar,
      imagen_evento: evento.imagen_evento, limite_por_persona: evento.limite_por_persona, tiene_seating: Boolean(evento.tiene_seating),
    },
    complejo: { nombre: t.nombre, logo_url: t.logo_url, color: t.color_primario, direccion: t.direccion },
    tipos: tipos.map((tp) => ({
      id_tipo: tp.id_tipo, nombre: tp.nombre_tipo, slug: slugTipo(tp.nombre_tipo), condiciones: tp.condiciones,
      precio: Number(tp.precio), disponible: tp.stock_disponible > 0,
      quedan: tp.stock_disponible > 0 && tp.stock_disponible <= 20 ? tp.stock_disponible : null,
      maximo: Math.min(tp.stock_disponible, evento.limite_por_persona || 10, 10),
    })),
    // Con asientos numerados hay que elegir butaca: la compra rápida no aplica
    vendible: vendible && !evento.tiene_seating,
    motivo: evento.tiene_seating ? 'seating' : !vendible ? (evento.estado === 'agotado' ? 'agotado' : 'no_disponible') : null,
    mercadopago_disponible: Boolean(cuenta?.conectado && cuenta.activo),
  };
};

/** QR de compra del evento (general y por tipo) para el panel del organizador. */
const qrsDeCompra = async (idEvento, idTenant) => {
  const evento = await Evento.findById(Number(idEvento));
  if (!evento || evento.id_tenant !== idTenant) throw new AppError(404, 'Evento no encontrado');
  const tipos = (await TipoTicket.findByEvento(evento.id_evento)).filter((t) => t.activo && !t.solo_admin);
  const cuenta = await MercadoPagoToken.publica(evento.id_tenant);
  return {
    mercadopago_disponible: Boolean(cuenta?.conectado && cuenta.activo),
    evento: { id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar, estado: evento.estado, tiene_seating: Boolean(evento.tiene_seating) },
    general: { url: urlCompra(evento.id_evento) },
    por_tipo: tipos.map((t) => ({ id_tipo: t.id_tipo, nombre: t.nombre_tipo, precio: Number(t.precio), slug: slugTipo(t.nombre_tipo), url: urlCompra(evento.id_evento, t) })),
  };
};

/**
 * Comprador del cobro asistido. Con nombre y teléfono se identifica como siempre (y recibe la entrada por correo
 * / WhatsApp); sin datos se crea un comprador anónimo «Cliente en puerta» para esa venta: la entrada le llega al
 * celular al volver de MercadoPago (/entrada/:token) y además se ve en la pantalla de la boletería.
 */
const compradorAnonimo = async () => Usuario.create({
  nombre: 'Cliente', apellido: 'en puerta', email: null, whatsapp: null, rol: 'comprador',
  password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
});

const MINUTOS_COBRO = () => Number(process.env.PUERTA_COBRO_MIN || 15);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Datos de operación de boletería que viajan con la compra (los guarda ejecutarVenta). */
const datosOperacion = (req) => {
  const obs = req.body.observaciones ? String(req.body.observaciones).trim().slice(0, 255) : null;
  Object.assign(req.compra, {
    origen: 'puerta_asistida', idStaff: req.usuario.id_usuario, observaciones: obs || null,
    claveIdempotencia: UUID_RE.test(String(req.body.clave || '')) ? String(req.body.clave).toLowerCase() : null,
  });
};

/** Auditoría de la venta de boletería, DENTRO de la transacción de ejecutarVenta (si falla, se revierte todo). */
const auditar = (req) => (conn, idVenta) => conn.query(
  'INSERT INTO auditoria_eventos (id_evento, id_usuario, accion, detalle) VALUES (?, ?, ?, ?)',
  [req.compra.evento.id_evento, req.usuario.id_usuario, 'venta_puerta', JSON.stringify({
    id_venta: idVenta, metodo_pago: req.compra.metodoPago, cantidad: req.compra.cantidadTotal, importe: req.compra.total,
    tipos: req.compra.lineas.map((l) => ({ id_tipo: l.id_tipo, tipo: l.tipo.nombre_tipo, cantidad: l.cantidad })),
    observaciones: req.compra.observaciones,
    // Quién, desde dónde y con qué dispositivo (la fecha y hora las registra la tabla)
    rol: req.usuario.rol, ip: req.ip, dispositivo: String(req.headers['user-agent'] || '').slice(0, 200),
  })]
);

/**
 * Medios de cobro permitidos en la boletería para este usuario: según sus permisos (config/permisos.js), la
 * configuración del complejo (tenants.boleteria_solo_efectivo) y si MercadoPago está conectado. Por defecto:
 * efectivo para el cobrador (caja rápida); MercadoPago para el admin si está disponible.
 */
const mediosBoleteria = async (tenant, rol) => {
  const { tienePermiso } = require('../config/permisos');
  const cuenta = await MercadoPagoToken.publica(tenant.id_tenant);
  const medios = [
    ...(tienePermiso(rol, 'venta_efectivo') ? ['efectivo'] : []),
    ...(tienePermiso(rol, 'venta_qr') && !tenant.boleteria_solo_efectivo && cuenta?.conectado && cuenta.activo ? ['mercadopago'] : []),
  ];
  const porDefecto = rol === 'cobrador' || !medios.includes('mercadopago') ? (medios.includes('efectivo') ? 'efectivo' : medios[0]) : 'mercadopago';
  return { medios, por_defecto: porDefecto || null, solo_efectivo: Boolean(tenant.boleteria_solo_efectivo) };
};

/**
 * Eventos que se pueden cobrar en la boletería: publicados o agotados, desde 12 h antes de empezar. Sin los de
 * asientos numerados (hay que elegir butaca: no son de caja rápida), así el cajero arranca en uno cobrable.
 */
const eventosBoleteria = async (idTenant) => (await pool.query(
  `SELECT id_evento, nombre, fecha, lugar, estado, tiene_seating FROM eventos
    WHERE id_tenant = ? AND estado IN ('publicado','agotado') AND NOT tiene_seating AND fecha > NOW() - INTERVAL 12 HOUR ORDER BY fecha`, [idTenant]))[0];

/** Datos de un evento para cobrar: tipos vendibles con precio y disponibilidad, y los medios permitidos. */
const datosBoleteria = async (idEvento, tenant, rol) => {
  const evento = await Evento.findById(Number(idEvento));
  if (!evento || evento.id_tenant !== tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
  const tipos = await tiposVendibles(evento.id_evento);
  return {
    evento: { id_evento: evento.id_evento, nombre: evento.nombre, fecha: evento.fecha, lugar: evento.lugar, estado: evento.estado, tiene_seating: Boolean(evento.tiene_seating) },
    tipos: tipos.map((t) => ({ id_tipo: t.id_tipo, nombre: t.nombre_tipo, precio: Number(t.precio), disponible: t.stock_disponible > 0, quedan: t.stock_disponible > 0 && t.stock_disponible <= 20 ? t.stock_disponible : null })),
    ...(await mediosBoleteria(tenant, rol)),
  };
};

/**
 * Respuesta de una operación de boletería ya registrada (reintento con la misma clave): mismo resultado que la
 * primera vez, sin crear nada. Para MercadoPago se reconstruye el QR desde el init_point guardado.
 */
const respuestaRegistrada = async (idVenta, idTenant) => {
  const estado = await estadoCobro(idVenta, idTenant);
  const venta = await Venta.findById(idVenta);
  if (venta.metodo_pago === 'efectivo') return { ...estado, metodo_pago: 'efectivo', repetida: true, cantidad: venta.cantidad_tickets, mensaje: 'Venta registrada en efectivo correctamente' };
  const [[pago]] = await pool.query("SELECT detalle FROM pagos WHERE id_venta = ? AND proveedor = 'mercadopago' ORDER BY id_pago DESC LIMIT 1", [idVenta]);
  let initPoint = null;
  try { initPoint = JSON.parse(pago?.detalle || '{}').init_point || null; } catch { initPoint = null; }
  return {
    ...estado, metodo_pago: 'mercadopago', repetida: true, init_point: initPoint, cantidad: venta.cantidad_tickets,
    qr_pago: initPoint ? await QRCode.toDataURL(initPoint, { width: 360, margin: 1, errorCorrectionLevel: 'M' }) : null,
  };
};

/** Si la clave ya registró una venta, devuelve esa operación (doble click / reintento). */
const operacionPrevia = async (clave, idTenant) => {
  if (!UUID_RE.test(String(clave || ''))) return null;
  const previa = await Venta.findByClave(String(clave).toLowerCase());
  return previa ? respuestaRegistrada(previa.id_venta, idTenant) : null;
};

/** Ejecuta la venta; si dos pedidos simultáneos con la misma clave chocan (UNIQUE), señala la que ganó. */
const ejecutarIdempotente = async (req, opciones) => {
  const { ejecutarVenta } = require('../controllers/ventasController'); // diferido: dependencia circular
  try {
    return await ejecutarVenta(req.compra, opciones);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' && req.compra.claveIdempotencia && /idempotencia/.test(e.sqlMessage || '')) {
      const previa = await Venta.findByClave(req.compra.claveIdempotencia);
      if (previa) { const err = new Error('Operación ya registrada'); err.previa = previa.id_venta; throw err; }
    }
    throw e;
  }
};

/**
 * Venta en EFECTIVO en la boletería: no usa MercadoPago. En UNA transacción (ejecutarVenta con marcarPagado):
 * valida stock con filas bloqueadas, registra la venta con metodo_pago = 'efectivo', el pago aprobado a nombre de
 * quien cobró, descuenta el stock, habilita los tickets y audita. Cualquier fallo revierte todo.
 */
const registrarVentaEfectivo = async (req) => {
  datosOperacion(req);
  let resultado;
  try {
    resultado = await ejecutarIdempotente(req, { marcarPagado: true, alConfirmar: auditar(req) });
  } catch (e) {
    if (e.previa) return respuestaRegistrada(e.previa, req.tenant.id_tenant);
    throw e;
  }
  return {
    ...(await estadoCobro(resultado.venta.id_venta, req.tenant.id_tenant)),
    metodo_pago: 'efectivo', cantidad: req.compra.cantidadTotal, mensaje: 'Venta registrada en efectivo correctamente',
  };
};

/** Crea la venta (sin descontar stock) y la preferencia; devuelve el QR de pago para mostrar en pantalla. */
const crearCobroAsistido = async (req) => {
  const { liberarVenta } = require('../controllers/ventasController'); // diferido: dependencia circular
  datosOperacion(req);
  const vence = Math.min(Date.now() + MINUTOS_COBRO() * 60 * 1000, new Date(req.compra.evento.fecha).getTime() + 6 * 3600 * 1000);
  let venta;
  let tickets;
  try {
    ({ venta, tickets } = await ejecutarIdempotente(req, { expiraEn: new Date(vence), alConfirmar: auditar(req) }));
  } catch (e) {
    if (e.previa) return respuestaRegistrada(e.previa, req.tenant.id_tenant);
    throw e;
  }
  let pref;
  try {
    const cp = req.body.comprador || {};
    pref = await pagos.preferenciaDeVenta(venta, tickets, {
      pagador: cp.nombre ? { nombre: cp.nombre.trim(), email: cp.email?.trim().toLowerCase(), telefono: req.body.whatsapp } : undefined,
      // El cliente vuelve de MercadoPago a su entrada (en su celular)
      retorno: `${frontend()}/entrada/${venta.token_acceso}`,
      fallo: `${frontend()}/entrada/${venta.token_acceso}`,
    });
  } catch (e) {
    await pool.withTransaction(async (conn) => liberarVenta(conn, await Venta.lockById(venta.id_venta, conn), 'cancelado'));
    throw e.status ? e : new AppError(502, `MercadoPago no pudo generar el cobro: ${e.message}`);
  }
  const cuenta = await MercadoPagoToken.publica(venta.id_tenant);
  const initPoint = cuenta && !cuenta.live_mode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
  return {
    metodo_pago: 'mercadopago', estado_pago: 'pending',
    id_venta: venta.id_venta, init_point: initPoint, monto_total: Number(venta.monto_total), cantidad: req.compra.cantidadTotal,
    expira_en: new Date(vence).toISOString(),
    qr_pago: await QRCode.toDataURL(initPoint, { width: 360, margin: 1, errorCorrectionLevel: 'M' }),
  };
};

/** Estado de un cobro para la pantalla de boletería (consulta cada 2 s). Con el pago aprobado trae las entradas. */
const estadoCobro = async (idVenta, idTenant) => {
  const venta = await Venta.findById(Number(idVenta));
  if (!venta || venta.id_tenant !== idTenant) throw new AppError(404, 'Cobro no encontrado');
  const estadoPago = venta.estado === 'pagado' ? 'approved'
    : venta.estado === 'cancelado' ? 'cancelled' : venta.estado === 'reembolsado' ? 'refunded'
      : venta.estado_ultimo_pago === 'rechazado' ? 'rejected' : 'pending';
  const base = { id_venta: venta.id_venta, estado: venta.estado, estado_pago: estadoPago, monto_total: Number(venta.monto_total), expira_en: venta.expira_en, comprador: venta.comprador };
  if (venta.estado !== 'pagado') return base;
  const tickets = await ticketsConLink(venta.id_venta);
  return { ...base, entrada_url: `${frontend()}/entrada/${venta.token_acceso}`, tickets: tickets.map((t) => ({ id_ticket: t.id_ticket, numero: t.numero, tipo: t.nombre_tipo, url: t.url })) };
};

module.exports = { datosCompraRapida, qrsDeCompra, crearCobroAsistido, registrarVentaEfectivo, operacionPrevia, estadoCobro, eventosBoleteria, datosBoleteria, mediosBoleteria, compradorAnonimo, slugTipo, urlCompra };
