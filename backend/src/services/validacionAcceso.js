const pool = require('../config/db');
const Ticket = require('../models/Ticket');

// Una entrada caduca 12 h después del inicio del evento (cubre fiestas que terminan de madrugada)
const CADUCA_MS = 12 * 60 * 60 * 1000;

/**
 * Valida un código QR en la puerta y, si corresponde, marca la entrada como ingresada.
 * Todo ocurre en una transacción con la fila del ticket bloqueada (FOR UPDATE): si dos
 * porteros escanean la misma entrada a la vez, sólo uno obtiene 'valido'.
 * Cada lectura (válida o no) queda registrada en la tabla accesos.
 *
 * @returns {{ resultado: 'valido'|'usado'|'invalido', motivo: string, fecha_ingreso: Date|null, ticket: object|false }}
 */
async function validarCodigo({ codigo, idEvento, idTenant, idValidador }) {
  return pool.withTransaction(async (conn) => {
    const t = await Ticket.lockByCodigo(codigo, conn);
    const propio = Boolean(t && t.id_tenant === idTenant);
    let resultado;
    let motivo;
    let fechaIngreso = null;

    if (!t) {
      resultado = 'invalido';
      motivo = 'Código inexistente o reemplazado por una transferencia';
    } else if (!propio) {
      resultado = 'invalido';
      motivo = 'El ticket pertenece a otro complejo';
    } else if (idEvento && t.id_evento !== idEvento) {
      resultado = 'invalido';
      motivo = `El ticket corresponde a otro evento (${t.evento})`;
    } else if (new Date(t.fecha_evento).getTime() + CADUCA_MS < Date.now()) {
      resultado = 'invalido';
      motivo = 'Entrada caducada: el evento ya terminó';
    } else if (t.estado_evento === 'cancelado') {
      resultado = 'invalido';
      motivo = 'El evento fue cancelado';
    } else if (t.estado === 'usado') {
      resultado = 'usado';
      fechaIngreso = t.fecha_uso;
      motivo = `Ya ingresó el ${new Date(t.fecha_uso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`;
    } else if (t.estado === 'pendiente' && t.metodo_pago === 'efectivo') {
      resultado = 'invalido';
      motivo = 'Pago en efectivo pendiente: el complejo todavía no validó la entrada';
    } else if (t.estado !== 'valido') {
      resultado = 'invalido';
      motivo = `Ticket en estado "${t.estado}"`;
    } else {
      await Ticket.marcarUsado(t.id_ticket, conn);
      resultado = 'valido';
      fechaIngreso = new Date();
      motivo = 'Acceso permitido';
    }

    await conn.query('INSERT INTO accesos (codigo_leido, id_ticket, resultado, id_validador) VALUES (?, ?, ?, ?)', [
      codigo.slice(0, 64), propio ? t.id_ticket : null, resultado, idValidador,
    ]);

    return {
      resultado,
      motivo,
      fecha_ingreso: fechaIngreso,
      ticket: propio && { id_ticket: t.id_ticket, evento: t.evento, nombre_tipo: t.nombre_tipo, asiento: t.asiento, titular: t.titular },
    };
  });
}

module.exports = { validarCodigo };
