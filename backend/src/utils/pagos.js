const crypto = require('crypto');

/**
 * Pasarela de pago SIMULADA. Reemplazar por la integración real (Mercado Pago, Stripe, etc.).
 *  - tarjeta:       aprobación inmediata si el número pasa Luhn; los terminados en 0000 se rechazan (prueba).
 *  - billetera:     aprobación inmediata con el alias de la billetera.
 *  - transferencia: queda pendiente hasta que un administrador confirma la acreditación.
 */
const luhn = (num) => {
  const digitos = String(num).replace(/\D/g, '');
  if (digitos.length < 13) return false;
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    let d = Number(digitos[digitos.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
  }
  return suma % 10 === 0;
};

const referencia = (prefijo) => `${prefijo}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

const procesarPago = async (metodo, monto, datos = {}) => {
  switch (metodo) {
    case 'tarjeta': {
      const numero = String(datos.numero_tarjeta || '').replace(/\D/g, '');
      if (!luhn(numero)) return { estado: 'rechazado', mensaje: 'Número de tarjeta inválido' };
      if (numero.endsWith('0000')) return { estado: 'rechazado', mensaje: 'Tarjeta rechazada por el emisor' };
      return { estado: 'aprobado', referencia: referencia('CARD') };
    }
    case 'billetera':
      if (!datos.alias_billetera) return { estado: 'rechazado', mensaje: 'Alias de billetera requerido' };
      return { estado: 'aprobado', referencia: referencia('WALLET') };
    case 'transferencia':
      return {
        estado: 'pendiente',
        referencia: referencia('TRF'),
        instrucciones: { cbu: '0000003100012345678901', alias: 'INTEGRA360.TICKETS', monto },
      };
    case 'cortesia':
      return { estado: 'aprobado', referencia: referencia('FREE') };
    default:
      return { estado: 'rechazado', mensaje: 'Método de pago no soportado' };
  }
};

module.exports = { procesarPago };
