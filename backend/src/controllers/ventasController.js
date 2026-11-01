const pool = require('../config/db');
const Venta = require('../models/Venta');
const Ticket = require('../models/Ticket');
const TipoTicket = require('../models/TipoTicket');
const Asiento = require('../models/Asiento');
const Evento = require('../models/Evento');
const Usuario = require('../models/Usuario');
const Pago = require('../models/Pago');
const ListaEspera = require('../models/ListaEspera');
const { generarCodigo, generarTokenAcceso } = require('../utils/qr');
const { enviarEntradasPorWhatsapp } = require('../services/notificaciones');
const { enviarEntradasPorCorreo } = require('../services/correo');
const pagos = require('../services/pagosService');
const { procesarPago } = require('../utils/pagos');
const { AppError, asyncHandler } = require('../utils/errors');
const { normalizarWhatsapp } = require('../utils/whatsapp');

// Minutos que una venta pendiente retiene el stock antes de expirar
const EXPIRACION_MIN = { tarjeta: 15, billetera: 15, mercadopago: 30, transferencia: 48 * 60 };

const esStaffDe = (usuario, idTenant) => usuario.rol === 'superadmin' || (usuario.rol === 'admin' && usuario.id_tenant === idTenant);

/**
 * Crea la venta y sus tickets en una sola transacción.
 * alConfirmar(conn, idVenta): pasos extra DENTRO de la misma transacción (ej. auditoría): si fallan, se revierte todo.
 * Datos de operación opcionales en compra: origen, idStaff (quién registró), observaciones, claveIdempotencia.
 * Revalida con filas bloqueadas (FOR UPDATE) el límite por persona, el stock y los asientos.
 *
 * Stock: las ventas con MercadoPago pendientes de pago NO descuentan stock (stock_descontado = 0): sólo se
 * verifica que haya. El descuento ocurre al aprobarse el pago (pagosService.confirmarStockDeVenta), igual
 * para todos los canales. El resto (cortesías, emisiones, efectivo, transferencia) descuenta al crear.
 */
const ejecutarVenta = async (compra, { empresa = null, marcarPagado = false, expiraEn = null, alConfirmar = null } = {}) => {
  const { evento, lineas, idTitular, tipoVenta, vendedor, whatsapp } = compra;
  const total = tipoVenta === 'invitacion' ? 0 : compra.total;
  const metodoPago = total === 0 ? 'cortesia' : compra.metodoPago;

  const resultado = await pool.withTransaction(async (conn) => {
    // Serializa compras concurrentes del mismo titular (límite por persona)
    await conn.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ? FOR UPDATE', [idTitular]);
    if (tipoVenta === 'normal' && evento.limite_por_persona) {
      const yaTiene = await Ticket.contarActivosUsuarioEvento(idTitular, evento.id_evento, conn);
      if (yaTiene + compra.cantidadTotal > evento.limite_por_persona) {
        throw new AppError(409, `Supera el límite de ${evento.limite_por_persona} tickets por persona`);
      }
    }

    const tipos = await TipoTicket.lockByIds(lineas.map((l) => l.id_tipo), conn);
    const tipoPorId = new Map(tipos.map((t) => [t.id_tipo, t]));
    for (const l of lineas) {
      const t = tipoPorId.get(l.id_tipo);
      if (t.stock_disponible < l.cantidad) {
        throw new AppError(409, `Stock insuficiente para "${t.nombre_tipo}" (disponibles: ${t.stock_disponible})`, { id_tipo: t.id_tipo, lista_espera: true });
      }
    }

    // Asientos: deben existir, ser del tipo elegido (y por lo tanto del evento) y estar libres
    const asientoPorId = new Map();
    const idsAsientos = lineas.flatMap((l) => l.asientos);
    if (idsAsientos.length) {
      for (const a of await Asiento.lockByIds(idsAsientos, conn)) asientoPorId.set(a.id_asiento, a);
      for (const l of lineas) {
        for (const id of l.asientos) {
          const a = asientoPorId.get(id);
          if (!a || a.id_evento !== evento.id_evento) throw new AppError(400, `Asiento ${id} no pertenece al evento`);
          if (a.id_tipo !== l.id_tipo) throw new AppError(400, `El asiento ${a.etiqueta} no corresponde al tipo elegido`);
          if (a.ocupado) throw new AppError(409, `El asiento ${a.etiqueta} ya está ocupado`);
        }
      }
    }

    const pagado = total === 0 || marcarPagado;
    const descontarAlAprobar = !pagado && metodoPago === 'mercadopago';
    const idVenta = await Venta.create(
      {
        id_usuario: idTitular, id_vendedor: vendedor?.id_vendedor, id_link: vendedor?.id_link, id_evento: evento.id_evento,
        monto_total: total, estado: pagado ? 'pagado' : 'pendiente', metodo_pago: metodoPago, tipo_venta: tipoVenta,
        empresa, whatsapp_contacto: whatsapp, token_acceso: generarTokenAcceso(), expira_en: pagado ? null : expiraEn,
        stock_descontado: !descontarAlAprobar, origen: compra.origen || null,
        id_usuario_staff: compra.idStaff, observaciones: compra.observaciones, clave_idempotencia: compra.claveIdempotencia,
      },
      conn
    );
    if (pagado) {
      // Efectivo cobrado en el acto (boletería): pago aprobado a nombre de quien recibió el dinero
      const proveedor = total === 0 ? 'cortesia' : metodoPago === 'efectivo' ? 'efectivo' : 'transferencia';
      const idPago = await Pago.create(
        { id_venta: idVenta, proveedor, estado: 'aprobado', monto: total, detalle: total === 0 ? 'Emisión sin cargo' : proveedor === 'efectivo' ? 'Cobrado en efectivo en la puerta' : 'Registrado por administración' },
        conn
      );
      if (proveedor === 'efectivo' && compra.idStaff) await Pago.registrarValidacion(idPago, compra.idStaff, conn);
    }

    const filas = [];
    for (const l of lineas) {
      if (!descontarAlAprobar) await TipoTicket.descontarStock(l.id_tipo, l.cantidad, conn);
      for (let i = 0; i < l.cantidad; i++) {
        filas.push([idVenta, l.id_tipo, idTitular, generarCodigo(), pagado ? 'valido' : 'pendiente', l.asientos[i] || null]);
      }
    }
    await Ticket.createMany(filas, conn);
    if (!descontarAlAprobar) await Evento.actualizarEstadoPorStock(evento.id_evento, conn);
    if (alConfirmar) await alConfirmar(conn, idVenta);

    return { venta: await Venta.findById(idVenta, conn), tickets: await Ticket.findByVenta(idVenta, conn) };
  });
  // Ventas gratuitas o ya pagadas: se envía el link de las entradas por WhatsApp (fuera de la transacción)
  if (resultado.venta.estado === 'pagado') {
    resultado.whatsapp = await enviarEntradasPorWhatsapp(resultado.venta.id_venta);
    resultado.correo = await enviarEntradasPorCorreo(resultado.venta.id_venta);
  }
  return resultado;
};

/**
 * Cancela (pendiente) o reembolsa (pagado) una venta: libera stock y asientos, cierra los pagos,
 * actualiza los tickets y avisa a la lista de espera. Debe llamarse dentro de una transacción.
 */
const liberarVenta = async (conn, venta, nuevoEstado) => {
  const [activos] = await conn.query(
    "SELECT id_tipo, COUNT(*) AS n FROM tickets WHERE id_venta = ? AND estado IN ('pendiente','valido') GROUP BY id_tipo",
    [venta.id_venta]
  );
  await Ticket.setEstadoPorVenta(venta.id_venta, nuevoEstado === 'reembolsado' ? 'reembolsado' : 'cancelado', conn);
  await Venta.setEstado(venta.id_venta, nuevoEstado, conn);
  await Pago.cerrarPorVenta(venta.id_venta, nuevoEstado, conn);
  // Una venta de MercadoPago que nunca se aprobó no había descontado stock: no hay nada que devolver
  if (Number(venta.stock_descontado) === 0) return;
  for (const { id_tipo, n } of activos) {
    await TipoTicket.devolverStock(id_tipo, n, conn);
    await ListaEspera.notificarLiberacion(id_tipo, n, conn);
  }
  await Evento.actualizarEstadoPorStock(venta.id_evento, conn);
};

exports.liberarVenta = liberarVenta;
exports.ejecutarVenta = ejecutarVenta;

/**
 * Tarea periódica: expira ventas pendientes que superaron su tiempo de reserva.
 *  - con expira_en (links de pago de vendedores): al llegar esa fecha
 *  - sin expira_en: según el método (EXPIRACION_MIN)
 */
exports.expirarPendientes = async () => {
  const [conVencimiento] = await pool.query("SELECT id_venta FROM ventas WHERE estado = 'pendiente' AND expira_en IS NOT NULL AND expira_en < NOW()");
  const grupos = [conVencimiento];
  for (const [metodo, minutos] of Object.entries(EXPIRACION_MIN)) {
    grupos.push((await pool.query(
      "SELECT id_venta FROM ventas WHERE estado = 'pendiente' AND expira_en IS NULL AND metodo_pago = ? AND tipo_venta = 'normal' AND fecha_venta < NOW() - INTERVAL ? MINUTE",
      [metodo, minutos]
    ))[0]);
  }
  for (const vencidas of grupos) {
    for (const { id_venta } of vencidas) {
      await pool.withTransaction(async (conn) => {
        const v = await Venta.lockById(id_venta, conn);
        if (v?.estado === 'pendiente') await liberarVenta(conn, v, 'cancelado');
      });
      console.log(`[ventas] Venta ${id_venta} expirada por falta de pago`);
    }
  }
};

// ---------- Endpoints ----------

/** POST /api/ventas — compra individual o múltiple del comprador. */
exports.crear = asyncHandler(async (req, res) => {
  const resultado = await ejecutarVenta(req.compra);
  res.status(201).json({
    ...resultado,
    mensaje: resultado.venta.estado === 'pagado' ? 'Tickets emitidos' : 'Venta creada, pendiente de pago',
    expira_en_minutos: resultado.venta.estado === 'pendiente' ? EXPIRACION_MIN[resultado.venta.metodo_pago] : null,
  });
});

/** Resuelve el destinatario por email para ventas corporativas / invitaciones (admin). */
exports.resolverDestinatario = asyncHandler(async (req, _res, next) => {
  const { email_destino } = req.body;
  if (!email_destino) throw new AppError(400, 'email_destino es obligatorio');
  const u = await Usuario.findByEmail(String(email_destino).toLowerCase());
  if (!u) throw new AppError(404, 'No existe un usuario con ese email');
  req.body.id_usuario_destino = u.id_usuario;
  next();
});

/** POST /api/ventas/corporativa — bloque de tickets para una empresa (admin). */
exports.crearCorporativa = asyncHandler(async (req, res) => {
  if (!req.body.empresa?.trim()) throw new AppError(400, 'El nombre de la empresa es obligatorio');
  const resultado = await ejecutarVenta(req.compra, { empresa: req.body.empresa.trim(), marcarPagado: !!req.body.marcar_pagado });
  res.status(201).json(resultado);
});

/** POST /api/ventas/invitaciones — tickets gratuitos (admin). */
exports.crearInvitacion = asyncHandler(async (req, res) => {
  const resultado = await ejecutarVenta(req.compra);
  res.status(201).json(resultado);
});

/**
 * POST /api/ventas/:id/pagar — inicia o procesa el pago de una venta pendiente del comprador.
 *  - mercadopago:   devuelve la URL de Checkout Pro del complejo (req.mercadopago lo elige el middleware)
 *  - transferencia: devuelve los datos bancarios; el admin confirma la acreditación
 *  - tarjeta / billetera: pasarela simulada (sólo con PAGOS_SIMULADOS=true)
 */
exports.pagar = asyncHandler(async (req, res) => {
  const venta = req.ventaCargada || (await Venta.findById(req.params.id));
  if (!venta) throw new AppError(404, 'Venta no encontrada');
  if (venta.id_usuario !== req.usuario.id_usuario) throw new AppError(403, 'La venta no le pertenece');
  if (venta.estado !== 'pendiente') throw new AppError(409, `La venta está ${venta.estado}`);

  if (venta.metodo_pago === 'mercadopago') {
    const pref = await pagos.preferenciaDeVenta(venta, await Ticket.findByVenta(venta.id_venta));
    const url = !req.mercadopago.live_mode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
    return res.json({ pago: { estado: 'redirigir', url, id_pago: pref.id_pago }, venta });
  }

  if (venta.metodo_pago === 'transferencia') {
    let pago = await Pago.pendienteDeVenta(venta.id_venta, 'transferencia');
    if (!pago) {
      const id = await Pago.create({ id_venta: venta.id_venta, proveedor: 'transferencia', monto: venta.monto_total, referencia_externa: `TRF-${venta.id_venta}-${Date.now().toString(36).toUpperCase()}` });
      pago = await Pago.findById(id);
    }
    return res.json({
      pago: { estado: 'pendiente', referencia: pago.referencia_externa, instrucciones: { cbu: '0000003100012345678901', alias: 'INTEGRA360.TICKETS', monto: venta.monto_total } },
      venta: await Venta.findById(venta.id_venta),
    });
  }

  // Pasarela simulada (desarrollo)
  if (process.env.PAGOS_SIMULADOS !== 'true') throw new AppError(409, 'Método de pago no disponible');
  const r = await procesarPago(venta.metodo_pago, venta.monto_total, req.body);
  const resultado = await pool.withTransaction(async (conn) => {
    const idPago = await Pago.create(
      { id_venta: venta.id_venta, proveedor: 'simulado', estado: r.estado === 'aprobado' ? 'pendiente' : 'rechazado', monto: venta.monto_total, referencia_externa: r.referencia || null, detalle: r.mensaje || null },
      conn
    );
    if (r.estado === 'aprobado') await pagos.aprobarVenta(conn, venta.id_venta, idPago, r.referencia);
    return { pago: r, venta: await Venta.findById(venta.id_venta, conn) };
  });
  if (r.estado === 'rechazado') throw new AppError(402, r.mensaje);
  resultado.whatsapp = await enviarEntradasPorWhatsapp(venta.id_venta);
  if (r.estado === 'aprobado') resultado.correo = await enviarEntradasPorCorreo(venta.id_venta);
  res.json(resultado);
});

/**
 * GET /api/ventas/:id/verificar-pago?payment_id= — el comprador vuelve de MercadoPago.
 * Consulta el pago con la cuenta del complejo (no confía en los parámetros de la URL) por si el webhook aún no llegó.
 */
exports.verificarPago = asyncHandler(async (req, res) => {
  const venta = await Venta.findById(req.params.id);
  if (!venta) throw new AppError(404, 'Venta no encontrada');
  if (venta.id_usuario !== req.usuario.id_usuario && !esStaffDe(req.usuario, venta.id_tenant)) throw new AppError(403, 'La venta no le pertenece');
  let detalle = null;
  if (req.query.payment_id && venta.metodo_pago === 'mercadopago' && venta.estado === 'pendiente') {
    detalle = await pagos.procesarPagoMercadoPago(venta.id_tenant, String(req.query.payment_id)).catch((e) => ({ error: e.message }));
  }
  res.json({ venta: await Venta.findById(venta.id_venta), detalle });
});

/**
 * POST /api/ventas/:id/confirmar-pago — el admin confirma un cobro manual: transferencia acreditada o
 * pago en efectivo recibido. Los tickets pasan de 'pendiente' a 'valido' (validado = true) y recién
 * ahí sirven para ingresar. Queda registrado quién lo confirmó y cuándo (pagos.id_validador / validado_en).
 * POST /api/ventas/:id/validar-efectivo es el mismo endpoint restringido a ventas en efectivo.
 */
const confirmarCobroManual = ({ soloEfectivo = false } = {}) => asyncHandler(async (req, res) => {
  const venta = await pool.withTransaction(async (conn) => {
    const v = await Venta.lockById(req.params.id, conn);
    if (!v || v.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Venta no encontrada');
    if (v.estado !== 'pendiente') throw new AppError(409, `La venta está ${v.estado}`);
    if (v.metodo_pago === 'mercadopago') throw new AppError(409, 'Los pagos de MercadoPago se acreditan automáticamente');
    if (soloEfectivo && v.metodo_pago !== 'efectivo') throw new AppError(409, 'La venta no es en efectivo');
    const proveedor = v.metodo_pago === 'efectivo' ? 'efectivo' : 'transferencia';
    const pendiente = await Pago.pendienteDeVenta(v.id_venta, proveedor, conn);
    const idPago = pendiente?.id_pago || (await Pago.create({ id_venta: v.id_venta, proveedor, monto: v.monto_total }, conn));
    await pagos.aprobarVenta(conn, v.id_venta, idPago, req.body.referencia || null);
    await Pago.registrarValidacion(idPago, req.usuario.id_usuario, conn);
    return Venta.findById(v.id_venta, conn);
  });
  const whatsapp = await enviarEntradasPorWhatsapp(venta.id_venta);
  const correo = await enviarEntradasPorCorreo(venta.id_venta);
  res.json({ ...venta, correo, tickets: (await Ticket.findByVenta(venta.id_venta)).map((t) => ({ id_ticket: t.id_ticket, estado: t.estado, validado: t.estado === 'valido' })), whatsapp });
});
exports.confirmarPago = confirmarCobroManual();
exports.validarEfectivo = confirmarCobroManual({ soloEfectivo: true });

/** POST /api/ventas/:id/cancelar — pendiente → cancelado; pagado → reembolsado (con devolución en MercadoPago). */
exports.cancelar = asyncHandler(async (req, res) => {
  const previa = await Venta.findById(req.params.id);
  if (!previa) throw new AppError(404, 'Venta no encontrada');
  const esStaff = esStaffDe(req.usuario, previa.id_tenant);
  if (!esStaff && previa.id_usuario !== req.usuario.id_usuario) {
    // Al personal de otro complejo no se le revela que la venta existe
    throw req.usuario.rol === 'admin' ? new AppError(404, 'Venta no encontrada') : new AppError(403, 'La venta no le pertenece');
  }

  const venta = await pool.withTransaction(async (conn) => {
    const v = await Venta.lockById(req.params.id, conn);
    if (!['pendiente', 'pagado'].includes(v.estado)) throw new AppError(409, `La venta ya está ${v.estado}`);
    const evento = await Evento.findById(v.id_evento, conn);
    const [[{ usados, transferidos }]] = await conn.query(
      `SELECT SUM(estado = 'usado') AS usados, SUM(id_usuario <> ? AND estado IN ('pendiente','valido')) AS transferidos
         FROM tickets WHERE id_venta = ?`,
      [v.id_usuario, v.id_venta]
    );
    if (Number(usados) > 0) throw new AppError(409, 'La venta tiene tickets ya utilizados');
    if (!esStaff) {
      if (new Date(evento.fecha) < new Date()) throw new AppError(409, 'El evento ya ocurrió');
      if (Number(transferidos) > 0) throw new AppError(409, 'Hay tickets transferidos a otros usuarios; no se puede cancelar');
    }
    // La devolución del dinero va primero: si MercadoPago falla, la venta no se marca como reembolsada
    if (v.estado === 'pagado') {
      await pagos.reembolsarEnMercadoPago({ ...v }).catch((e) => {
        throw new AppError(502, `No se pudo reembolsar en MercadoPago: ${e.message}`);
      });
    }
    await liberarVenta(conn, v, v.estado === 'pagado' ? 'reembolsado' : 'cancelado');
    return Venta.findById(v.id_venta, conn);
  });
  res.json(venta);
});

exports.misVentas = asyncHandler(async (req, res) => res.json(await Venta.findByUsuario(req.usuario.id_usuario)));

exports.listar = asyncHandler(async (req, res) => res.json(await Venta.findAll({ ...req.query, id_tenant: req.tenant.id_tenant })));

exports.detalle = asyncHandler(async (req, res) => {
  const venta = await Venta.findById(req.params.id);
  if (!venta) throw new AppError(404, 'Venta no encontrada');
  if (venta.id_usuario !== req.usuario.id_usuario && !esStaffDe(req.usuario, venta.id_tenant)) throw new AppError(403, 'La venta no le pertenece');
  res.json({ ...venta, tickets: await Ticket.findByVenta(venta.id_venta), pagos: await Pago.findByVenta(venta.id_venta) });
});

/** POST /api/ventas/:id/reenviar-whatsapp — reenvía el link de entradas (admin del tenant o el comprador). */
exports.reenviarWhatsapp = asyncHandler(async (req, res) => {
  const venta = await Venta.findById(req.params.id);
  if (!venta) throw new AppError(404, 'Venta no encontrada');
  if (venta.id_usuario !== req.usuario.id_usuario && !esStaffDe(req.usuario, venta.id_tenant)) throw new AppError(403, 'La venta no le pertenece');
  if (venta.estado !== 'pagado') throw new AppError(409, 'Solo se envían entradas de ventas pagadas');
  if (req.body.whatsapp) {
    const numero = normalizarWhatsapp(req.body.whatsapp, process.env.WHATSAPP_PAIS_DEFECTO || 'AR');
    if (!numero) throw new AppError(400, 'Número de WhatsApp inválido');
    await Venta.setWhatsapp(venta.id_venta, numero);
  }
  const r = await enviarEntradasPorWhatsapp(venta.id_venta);
  if (!r.enviado) throw new AppError(502, `No se pudo enviar el WhatsApp: ${r.motivo}`);
  res.json({ mensaje: 'Link de entradas enviado por WhatsApp', provider: r.provider });
});
