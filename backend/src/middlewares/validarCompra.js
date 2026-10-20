const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const Ticket = require('../models/Ticket');
const LinkVenta = require('../models/LinkVenta');
const Usuario = require('../models/Usuario');
const { normalizarWhatsapp } = require('../utils/whatsapp');
const { AppError } = require('../utils/errors');

const { metodosDisponibles, metodosVendedor } = require('../services/pagosService');

/**
 * Validación previa de una compra (falla rápido antes de abrir la transacción).
 * Verifica: evento vendible, tipos del evento, ventana de venta, stock disponible,
 * límite de tickets por persona y asientos cuando el evento tiene seating plan.
 * El controlador vuelve a verificar stock/asientos/límite con filas bloqueadas.
 *
 * Multi-tenant: las ventas administrativas solo sobre eventos del tenant de la sesión; si la compra llega
 * desde un link de vendedor (codigo_link) se valida que el link/vendedor esté activo y sea del tenant del evento.
 * WhatsApp: obligatorio en compras normales; se valida y normaliza a E.164.
 *
 * tipoVenta: 'normal' (usuario) | 'corporativa' | 'invitacion' (solo admin; ignoran el límite por persona)
 *          | 'vendedor' (link de pago que genera un vendedor para un comprador: mismas reglas que 'normal',
 *            pero el titular es req.body.id_usuario_destino, el evento debe ser del complejo del vendedor
 *            y los medios son los habilitados para vendedores: mercadopago y, si el admin lo permite, efectivo)
 */
const validarCompra = (tipoVenta = 'normal') => async (req, _res, next) => {
  try {
    const { id_evento, metodo_pago, items } = req.body;
    const esVendedor = tipoVenta === 'vendedor';
    const comoNormal = tipoVenta === 'normal' || esVendedor; // reglas de venta al público
    if (!id_evento) throw new AppError(400, 'id_evento es obligatorio');
    if (!Array.isArray(items) || items.length === 0) throw new AppError(400, 'Debe seleccionar al menos un tipo de ticket');

    // Agrupa items repetidos del mismo tipo
    const porTipo = new Map();
    for (const it of items) {
      const cantidad = Number(it.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1) throw new AppError(400, 'La cantidad debe ser un entero mayor a 0');
      const previo = porTipo.get(Number(it.id_tipo)) || { id_tipo: Number(it.id_tipo), cantidad: 0, asientos: [] };
      previo.cantidad += cantidad;
      previo.asientos.push(...(it.asientos || []).map(Number));
      porTipo.set(previo.id_tipo, previo);
    }

    const evento = await Evento.findById(id_evento);
    if (!evento) throw new AppError(404, 'Evento no encontrado');
    if (tipoVenta !== 'normal' && evento.id_tenant !== req.tenant.id_tenant) throw new AppError(404, 'Evento no encontrado');
    if (evento.estado_tenant !== 'activo') throw new AppError(409, 'El complejo no está operando');
    const estadosVendibles = comoNormal ? ['publicado'] : ['publicado', 'agotado'];
    if (!estadosVendibles.includes(evento.estado)) throw new AppError(409, `El evento no está a la venta (estado: ${evento.estado})`);
    if (new Date(evento.fecha) < new Date()) throw new AppError(409, 'El evento ya ocurrió');

    const ahora = new Date();
    let total = 0;
    let cantidadTotal = 0;
    const lineas = [];
    for (const item of porTipo.values()) {
      const tipo = await TipoTicket.findById(item.id_tipo);
      if (!tipo || tipo.id_evento !== evento.id_evento) throw new AppError(400, `Tipo de ticket ${item.id_tipo} no pertenece al evento`);
      if (!tipo.activo) throw new AppError(409, `El tipo "${tipo.nombre_tipo}" no está disponible`);
      if (tipo.solo_admin && comoNormal) throw new AppError(403, `El tipo "${tipo.nombre_tipo}" solo lo emite la organización`);
      if (comoNormal) {
        if (tipo.venta_desde && new Date(tipo.venta_desde) > ahora) throw new AppError(409, `La venta de "${tipo.nombre_tipo}" aún no comenzó`);
        if (tipo.venta_hasta && new Date(tipo.venta_hasta) < ahora) throw new AppError(409, `La venta de "${tipo.nombre_tipo}" finalizó`);
      }
      if (tipo.stock_disponible < item.cantidad) {
        throw new AppError(409, `Stock insuficiente para "${tipo.nombre_tipo}" (disponibles: ${tipo.stock_disponible})`, {
          id_tipo: tipo.id_tipo,
          stock_disponible: tipo.stock_disponible,
          lista_espera: true,
        });
      }

      if (evento.tiene_seating) {
        const unicos = new Set(item.asientos);
        if (unicos.size !== item.asientos.length) throw new AppError(400, 'Hay asientos repetidos en la selección');
        if (item.asientos.length !== item.cantidad) {
          throw new AppError(400, `Debe elegir ${item.cantidad} asiento(s) para "${tipo.nombre_tipo}"`);
        }
      } else if (item.asientos.length) {
        throw new AppError(400, 'Este evento no tiene asientos numerados');
      }

      total += Number(tipo.precio) * item.cantidad;
      cantidadTotal += item.cantidad;
      lineas.push({ ...item, tipo });
    }

    // Límite por persona (solo compras de usuario). Cuenta tickets activos que ya posee (comprados o recibidos).
    const idTitular = tipoVenta === 'normal' ? req.usuario.id_usuario : Number(req.body.id_usuario_destino || req.usuario.id_usuario);
    if (comoNormal && evento.limite_por_persona) {
      const yaTiene = await Ticket.contarActivosUsuarioEvento(idTitular, evento.id_evento);
      if (yaTiene + cantidadTotal > evento.limite_por_persona) {
        throw new AppError(409, `Supera el límite de ${evento.limite_por_persona} tickets por persona (ya posee ${yaTiene})`, {
          limite: evento.limite_por_persona,
          ya_tiene: yaTiene,
        });
      }
    }

    if (esVendedor) {
      const metodos = await metodosVendedor(req.tenant);
      if (total > 0 && !metodos.includes(metodo_pago)) {
        throw new AppError(metodo_pago === 'efectivo' ? 403 : 409, metodo_pago === 'efectivo'
          ? 'El complejo no tiene habilitado el pago en efectivo'
          : 'El complejo no tiene MercadoPago conectado: pedile al administrador que lo conecte');
      }
    } else if (tipoVenta === 'normal') {
      const metodos = await metodosDisponibles(evento.id_tenant);
      if (total > 0 && !metodos.includes(metodo_pago)) throw new AppError(400, `Método de pago no disponible en este complejo (${metodos.join(', ')})`);
    }

    // Link de vendedor (punto de venta)
    let vendedor = null;
    if (tipoVenta === 'normal' && req.body.codigo_link) {
      const link = await LinkVenta.findByCodigo(String(req.body.codigo_link));
      if (!link || !link.activo || link.estado_vendedor !== 'activo') throw new AppError(409, 'El link de venta no está activo');
      if (link.id_tenant !== evento.id_tenant) throw new AppError(409, 'El link de venta no corresponde a este complejo');
      if (link.id_evento && link.id_evento !== evento.id_evento) throw new AppError(409, 'El link de venta es de otro evento');
      vendedor = { id_vendedor: link.id_vendedor, id_link: link.id_link };
    }

    // WhatsApp de contacto: el indicado en la compra o el del perfil del titular
    const pais = process.env.WHATSAPP_PAIS_DEFECTO || 'AR';
    let whatsapp = req.body.whatsapp;
    if (!whatsapp) whatsapp = (await Usuario.findById(idTitular))?.whatsapp;
    const whatsappNormalizado = whatsapp ? normalizarWhatsapp(whatsapp, pais) : null;
    if (whatsapp && !whatsappNormalizado) throw new AppError(400, 'Número de WhatsApp inválido (debe ser un celular, ej. +54 9 11 2345 6789)');
    if (comoNormal && !whatsappNormalizado) throw new AppError(400, 'El número de WhatsApp es obligatorio para recibir las entradas');

    // El vendedor queda como canal de la venta (sin link público asociado)
    if (esVendedor) vendedor = { id_vendedor: req.vendedor.id_vendedor, id_link: req.linkVenta?.id_link || null };

    req.compra = {
      vendedor,
      whatsapp: whatsappNormalizado,
      evento,
      lineas,
      total,
      cantidadTotal,
      idTitular,
      tipoVenta: esVendedor ? 'normal' : tipoVenta,
      metodoPago: total === 0 ? 'cortesia' : metodo_pago || 'transferencia',
    };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { validarCompra };
