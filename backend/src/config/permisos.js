/**
 * Permisos por rol (fuente única, declarativa). El backend los exige con requierePermiso() y el frontend los
 * recibe en la sesión (usuario.permisos) para decidir qué mostrar: no hay chequeos de rol repartidos por la app.
 *
 *  acceso_boleteria  entrar a la boletería (/admin/porteros/venta) y ver sus datos
 *  venta_efectivo    registrar ventas en efectivo
 *  venta_qr          generar cobros con QR de MercadoPago (además, el complejo puede limitar la boletería
 *                    a efectivo: tenants.boleteria_solo_efectivo)
 *
 * Para dar o quitar una capacidad a un rol se cambia acá, en un solo lugar.
 */
const PERMISOS = {
  acceso_boleteria: 'Entrar a la boletería',
  venta_efectivo: 'Cobrar en efectivo',
  venta_qr: 'Cobrar con QR de MercadoPago',
};

const POR_ROL = {
  superadmin: Object.keys(PERMISOS),
  admin: ['acceso_boleteria', 'venta_efectivo', 'venta_qr'],
  cobrador: ['acceso_boleteria', 'venta_efectivo', 'venta_qr'],
};

const permisosDe = (rol) => POR_ROL[rol] || [];
const tienePermiso = (rol, permiso) => permisosDe(rol).includes(permiso);

module.exports = { PERMISOS, permisosDe, tienePermiso };
