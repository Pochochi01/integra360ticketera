const pool = require('../config/db');
const Pago = require('../models/Pago');
const Venta = require('../models/Venta');
const Ticket = require('../models/Ticket');
const { MercadoPagoToken } = require('../models/MercadoPagoToken');
const { conCredenciales } = require('./mercadopagoTokens');
const { Suscripcion } = require('../models/Suscripcion');
const mp = require('./mercadopagoService');
const { enviarEntradasPorWhatsapp } = require('./notificaciones');
const { telefonoMercadoPago } = require('../utils/whatsapp');

const simulados = () => process.env.PAGOS_SIMULADOS === 'true';
const backend = () => (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
const frontend = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Métodos de pago que ofrece un complejo: MercadoPago si tiene una cuenta conectada y activa, transferencia, y los simulados en desarrollo. */
const metodosDisponibles = async (idTenant) => {
  const cuenta = await MercadoPagoToken.publica(idTenant);
  return [
    ...(cuenta?.conectado && cuenta.activo ? ['mercadopago'] : []),
    'transferencia',
    ...(simulados() ? ['tarjeta', 'billetera'] : []),
  ];
};

/**
 * Medios con los que un VENDEDOR puede generar links de pago:
 *  - mercadopago (por defecto): con la cuenta OAuth conectada y activa del complejo
 *  - efectivo: sólo si el admin lo habilitó (tenants.efectivo_habilitado)
 */
const metodosVendedor = async (tenant) => {
  const cuenta = await MercadoPagoToken.publica(tenant.id_tenant);
  return [
    ...(cuenta?.conectado && cuenta.activo ? ['mercadopago'] : []),
    ...(tenant.efectivo_habilitado ? ['efectivo'] : []),
  ];
};

/**
 * Aprueba el pago de una venta dentro de una transacción: pago → aprobado, venta → pagado, tickets → válidos.
 * Idempotente: si la venta ya estaba pagada no hace nada.
 */
const aprobarVenta = async (conn, idVenta, idPago, referencia = null) => {
  const venta = await Venta.lockById(idVenta, conn);
  if (!venta) return { cambio: false };
  if (idPago) await Pago.actualizar(idPago, { estado: 'aprobado', referencia_externa: referencia }, conn);
  if (venta.estado !== 'pendiente') return { cambio: false, venta };
  await Venta.setEstado(idVenta, 'pagado', conn);
  await Ticket.validarPorVenta(idVenta, conn);
  return { cambio: true, venta };
};

/**
 * Crea (o reutiliza) la preferencia de Checkout Pro de una venta con la cuenta del tenant (ámbito = id_tenant).
 * Si la venta tiene expira_en (link de vendedor), la preferencia deja de aceptar pagos en ese momento.
 */
const preferenciaDeVenta = async (venta, tickets, { pagador } = {}) => {
  const existente = await Pago.pendienteDeVenta(venta.id_venta, 'mercadopago');
  if (existente?.preference_id && existente.detalle) return { id_pago: existente.id_pago, ...JSON.parse(existente.detalle) };

  const idPago = existente?.id_pago || (await Pago.create({ id_venta: venta.id_venta, proveedor: 'mercadopago', monto: venta.monto_total }));
  const porTipo = {};
  for (const t of tickets) {
    porTipo[t.id_tipo] ??= { title: `${venta.evento} - ${t.nombre_tipo}`, quantity: 0, unit_price: t.precio };
    porTipo[t.id_tipo].quantity++;
  }
  // Links generados por un vendedor: el comprador no tiene sesión, vuelve a la página pública de su reserva
  const retorno = venta.expira_en && venta.id_vendedor
    ? `${frontend()}/entrada/${venta.token_acceso}`
    : `${frontend()}/ventas/${venta.id_venta}/resultado`;
  const pref = await conCredenciales(venta.id_tenant, (cred) => mp.crearPreferencia(cred, {
    titulo: venta.tenant,
    items: Object.values(porTipo),
    externalReference: `venta:${venta.id_venta}:pago:${idPago}`,
    notificationUrl: `${backend()}/api/pagos/webhook/mercadopago/${venta.id_tenant}`,
    backUrls: { success: retorno, pending: retorno, failure: retorno },
    // Datos del comprador para el checkout (los del formulario si los hay; si no, los de su cuenta)
    payer: {
      name: (pagador?.nombre || venta.comprador || '').split(' ')[0] || undefined,
      surname: pagador?.apellido || (pagador?.nombre || venta.comprador || '').split(' ').slice(1).join(' ') || undefined,
      email: pagador?.email || venta.email_comprador || undefined,
      phone: telefonoMercadoPago(pagador?.telefono || venta.whatsapp_contacto),
    },
    expiraEn: venta.expira_en || null,
  }));
  const links = { init_point: pref.init_point, sandbox_init_point: pref.sandbox_init_point };
  await Pago.actualizar(idPago, { preference_id: pref.id, detalle: JSON.stringify(links) });
  return { id_pago: idPago, ...links };
};

/** Preferencia para cobrar un mes de suscripción con la cuenta de la plataforma (ámbito 0). */
const preferenciaDeSuscripcion = async (suscripcion) => {
  const idPago = await Pago.create({ id_suscripcion: suscripcion.id_suscripcion, proveedor: 'mercadopago', monto: suscripcion.precio_mensual });
  const retorno = `${frontend()}/admin/complejo`;
  const pref = await conCredenciales(0, (cred) => mp.crearPreferencia(cred, {
    titulo: 'Integra360',
    items: [{ title: `Integra360 · Plan ${suscripcion.plan} · 1 mes`, quantity: 1, unit_price: suscripcion.precio_mensual }],
    externalReference: `suscripcion:${suscripcion.id_suscripcion}:pago:${idPago}`,
    notificationUrl: `${backend()}/api/pagos/webhook/mercadopago/plataforma`,
    backUrls: { success: retorno, pending: retorno, failure: retorno },
  }));
  const links = { init_point: pref.init_point, sandbox_init_point: pref.sandbox_init_point };
  await Pago.actualizar(idPago, { preference_id: pref.id, detalle: JSON.stringify(links) });
  return { id_pago: idPago, ...links };
};

/**
 * Procesa un payment_id de MercadoPago (webhook o retorno del comprador).
 * ambito: id_tenant (ventas) o 0 (plataforma, suscripciones). Consulta el pago con la cuenta de ese ámbito,
 * valida referencia, monto y cuenta receptora, y actualiza el estado de forma idempotente.
 */
const procesarPagoMercadoPago = async (ambito, paymentId) => {
  let cuentaReceptora;
  const pagoMp = await conCredenciales(Number(ambito), (cred) => {
    cuentaReceptora = cred.mp_user_id;
    return mp.obtenerPago(cred, paymentId);
  });
  const [tipo, idOrigen, , idPagoStr] = String(pagoMp.external_reference || '').split(':');
  const idPago = Number(idPagoStr);
  if (!idPago || !['venta', 'suscripcion'].includes(tipo)) return { ignorado: 'Referencia externa desconocida' };
  if (cuentaReceptora && pagoMp.collector_id && String(pagoMp.collector_id) !== String(cuentaReceptora)) {
    return { ignorado: 'El pago no pertenece a esta cuenta' };
  }
  const estado = mp.mapearEstado(pagoMp.status);
  let enviarWhatsapp = null;
  let reembolsoTardio = null;

  const resultado = await pool.withTransaction(async (conn) => {
    const pago = await Pago.lockById(idPago, conn);
    if (!pago) return { ignorado: 'Pago inexistente' };
    if (tipo === 'venta') {
      const venta = await Venta.lockById(Number(idOrigen), conn);
      if (!venta || pago.id_venta !== venta.id_venta || venta.id_tenant !== Number(ambito)) return { ignorado: 'La venta no corresponde' };
      if (estado === 'aprobado') {
        if (Math.abs(Number(pagoMp.transaction_amount) - Number(venta.monto_total)) > 0.01) {
          await Pago.actualizar(idPago, { estado: 'rechazado', referencia_externa: String(pagoMp.id), detalle: 'Monto no coincide' }, conn);
          return { ignorado: 'Monto no coincide' };
        }
        if (['cancelado', 'reembolsado'].includes(venta.estado)) {
          // Pagó después de que la reserva expiró: el stock ya se liberó, se devuelve el dinero
          await Pago.actualizar(idPago, { estado: 'aprobado', referencia_externa: String(pagoMp.id), detalle: 'Pago tardío: se reembolsa' }, conn);
          reembolsoTardio = { idPago, paymentId: String(pagoMp.id) };
          return { tipo, id: venta.id_venta, estado: 'reembolsado' };
        }
        const r = await aprobarVenta(conn, venta.id_venta, idPago, String(pagoMp.id));
        if (r.cambio) enviarWhatsapp = venta.id_venta;
        return { tipo, id: venta.id_venta, estado };
      }
      await Pago.actualizar(idPago, { estado, referencia_externa: String(pagoMp.id) }, conn);
      return { tipo, id: venta.id_venta, estado };
    }
    // Suscripción (cuenta de la plataforma)
    if (Number(ambito) !== 0 || pago.id_suscripcion !== Number(idOrigen)) return { ignorado: 'La suscripción no corresponde' };
    const yaAprobado = pago.estado === 'aprobado';
    await Pago.actualizar(idPago, { estado, referencia_externa: String(pagoMp.id) }, conn);
    if (estado === 'aprobado' && !yaAprobado) {
      await Suscripcion.lockById(pago.id_suscripcion, conn);
      await Suscripcion.extenderUnMes(pago.id_suscripcion, conn);
    }
    return { tipo, id: pago.id_suscripcion, estado };
  });

  if (enviarWhatsapp) resultado.whatsapp = await enviarEntradasPorWhatsapp(enviarWhatsapp);
  if (reembolsoTardio) {
    await conCredenciales(Number(ambito), (cred) => mp.reembolsar(cred, reembolsoTardio.paymentId));
    await Pago.actualizar(reembolsoTardio.idPago, { estado: 'reembolsado' });
  }
  return resultado;
};

/** Reembolso en MercadoPago de los pagos aprobados de una venta (antes de marcarla reembolsada). */
const reembolsarEnMercadoPago = async (venta) => {
  const pagos = (await Pago.findByVenta(venta.id_venta)).filter((p) => p.proveedor === 'mercadopago' && p.estado === 'aprobado');
  if (!pagos.length) return;
  for (const p of pagos) await conCredenciales(venta.id_tenant, (cred) => mp.reembolsar(cred, p.referencia_externa));
};

module.exports = { metodosDisponibles, metodosVendedor, aprobarVenta, preferenciaDeVenta, preferenciaDeSuscripcion, procesarPagoMercadoPago, reembolsarEnMercadoPago };
