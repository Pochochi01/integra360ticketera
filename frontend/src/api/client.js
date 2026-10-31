import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

/** Claves de localStorage compartidas con los contextos. */
export const STORAGE = { token: 'token', tenant: 'tenant', referido: 'ref_venta' };

const leer = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

api.interceptors.request.use((config) => {
  const token = leer(STORAGE.token);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Tenant elegido (visitantes / superadmin). En producción también se detecta por subdominio.
  const tenant = leer(STORAGE.tenant);
  // Una petición puede forzar "sin tenant" enviando X-Tenant: '' (vista global / links de otro complejo)
  if (tenant && config.headers['X-Tenant'] === undefined) config.headers['X-Tenant'] = tenant;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && leer(STORAGE.token)) {
      localStorage.removeItem(STORAGE.token);
      window.dispatchEvent(new Event('sesion-expirada'));
    }
    return Promise.reject(err);
  }
);

/** Mensaje legible de un error de Axios. */
export const mensajeError = (err) => err.response?.data?.error || err.message || 'Error inesperado';

const datos = (r) => r.data;

export const authApi = {
  login: (d) => api.post('/auth/login', d).then(datos),
  register: (d) => api.post('/auth/register', d).then(datos),
  me: () => api.get('/auth/me').then(datos),
  actualizar: (d) => api.put('/auth/me', d).then(datos),
  validarWhatsapp: (numero) => api.get('/auth/validar-whatsapp', { params: { numero } }).then(datos),
};

export const tenantsApi = {
  publico: () => api.get('/tenants/publico').then(datos),
  listar: () => api.get('/tenants').then(datos),
  detalle: (id) => api.get(`/tenants/${id}`).then(datos),
  crear: (d) => api.post('/tenants', d).then(datos),
  actualizar: (id, d) => api.put(`/tenants/${id}`, d).then(datos),
  mio: () => api.get('/tenants/mio').then(datos),
  actualizarMio: (d) => api.put('/tenants/mio', d).then(datos),
};

export const eventosApi = {
  listar: (tenant) => api.get('/eventos', tenant === null ? { headers: { 'X-Tenant': '' } } : undefined).then(datos),
  listarTodos: () => api.get('/eventos/admin/todos').then(datos),
  detalle: (id) => api.get(`/eventos/${id}`, { headers: { 'X-Tenant': '' } }).then(datos),
  crear: (d) => api.post('/eventos', d).then(datos),
  actualizar: (id, d) => api.put(`/eventos/${id}`, d).then(datos),
  eliminar: (id) => api.delete(`/eventos/${id}`),
  cancelar: (id) => api.post(`/eventos/${id}/cancelar`).then(datos),
  crearTipo: (id, d) => api.post(`/eventos/${id}/tipos`, d).then(datos),
  actualizarTipo: (idTipo, d) => api.put(`/eventos/tipos/${idTipo}`, d).then(datos),
  eliminarTipo: (idTipo) => api.delete(`/eventos/tipos/${idTipo}`),
  subirImagen: (id, archivo) => {
    const fd = new FormData();
    fd.append('imagen', archivo);
    return api.post(`/eventos/${id}/imagen`, fd).then(datos);
  },
  quitarImagen: (id) => api.delete(`/eventos/${id}/imagen`),
  generarAsientos: (id, d) => api.post(`/eventos/${id}/asientos`, d).then(datos),
  unirseEspera: (idTipo, cantidad) => api.post(`/eventos/tipos/${idTipo}/lista-espera`, { cantidad }).then(datos),
  miEspera: () => api.get('/eventos/lista-espera/mia').then(datos),
  salirEspera: (id) => api.delete(`/eventos/lista-espera/${id}`),
};

export const ventasApi = {
  comprar: (d) => api.post('/ventas', d).then(datos),
  corporativa: (d) => api.post('/ventas/corporativa', d).then(datos),
  invitacion: (d) => api.post('/ventas/invitaciones', d).then(datos),
  mias: () => api.get('/ventas/mias').then(datos),
  listar: (params) => api.get('/ventas', { params }).then(datos),
  detalle: (id) => api.get(`/ventas/${id}`).then(datos),
  pagar: (id, d) => api.post(`/ventas/${id}/pagar`, d).then(datos),
  verificarPago: (id, payment_id) => api.get(`/ventas/${id}/verificar-pago`, { params: { payment_id } }).then(datos),
  confirmarPago: (id) => api.post(`/ventas/${id}/confirmar-pago`).then(datos),
  // Pago en efectivo recibido: los tickets pasan a validados
  validarEfectivo: (id) => api.post(`/ventas/${id}/validar-efectivo`).then(datos),
  cancelar: (id) => api.post(`/ventas/${id}/cancelar`).then(datos),
  reenviarWhatsapp: (id, whatsapp) => api.post(`/ventas/${id}/reenviar-whatsapp`, { whatsapp }).then(datos),
};

export const ticketsApi = {
  mios: () => api.get('/tickets/mios').then(datos),
  transferencias: () => api.get('/tickets/transferencias').then(datos),
  /** PNG de la entrada (evento + QR); requiere JWT, por eso se pide como blob. */
  imagen: (id) => api.get(`/tickets/${id}/imagen`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
  transferir: (id, email_destino) => api.post(`/tickets/${id}/transferir`, { email_destino }).then(datos),
};

export const vendedoresApi = {
  listar: () => api.get('/vendedores').then(datos),
  detalle: (id) => api.get(`/vendedores/${id}`).then(datos),
  crear: (d) => api.post('/vendedores', d).then(datos),
  actualizar: (id, d) => api.put(`/vendedores/${id}`, d).then(datos),
  eliminar: (id) => api.delete(`/vendedores/${id}`).then((r) => r.data),
  ventas: (id) => api.get(`/vendedores/${id}/ventas`).then(datos),
};

export const vendedorApi = {
  perfil: () => api.get('/vendedor/perfil').then(datos),
  eventos: () => api.get('/vendedor/eventos').then(datos),
  links: () => api.get('/vendedor/links').then(datos),
  crearLink: (d) => api.post('/vendedor/links', d).then(datos),
  actualizarLink: (id, d) => api.patch(`/vendedor/links/${id}`, d).then(datos),
  enviarLink: (id, d) => api.post(`/vendedor/links/${id}/enviar`, d).then(datos),
  // estado_pago: approved | pending | rejected (opcional)
  ventas: (params) => api.get('/vendedor/ventas', { params }).then(datos),
  // Links reutilizables del vendedor (/venta/:linkId): misma interfaz que salesLinksApi del admin
  salesLinks: () => api.get('/vendedor/sales-links').then(datos),
  crearSalesLink: (d) => api.post('/vendedor/sales-links', d).then(datos),
  actualizarSalesLink: (id, d) => api.patch(`/vendedor/sales-links/${id}`, d).then(datos),
  ticketsSalesLink: (id) => api.get(`/vendedor/sales-links/${id}/tickets`).then(datos),
  reenviarCorreo: (idVenta) => api.post(`/vendedor/ventas/${idVenta}/reenviar-correo`).then(datos),
};

// Página /checkout/:linkId (pública): datos del complejo y creación del pago en MercadoPago
export const pagosApi = {
  checkout: (linkId) => api.get(`/publico/checkout/${linkId}`, { headers: { 'X-Tenant': '' } }).then(datos),
  // Checkout único de MercadoPago (el link de vendedor se identifica por link_id)
  crear: (d) => api.post('/ventas/checkout', d, { headers: { 'X-Tenant': '' } }).then(datos),
};

// Panel del admin: estadísticas de un evento (el panel las vuelve a pedir cada 10 s)
export const adminApi = {
  estadisticasEvento: (id) => api.get(`/admin/event/${id}/stats`).then(datos),
  // Evento con stock total y auditoría; update edita datos y SUMA entradas ({ agregar_stock: [{ id_tipo, cantidad }] })
  evento: (id) => api.get(`/admin/event/${id}`).then(datos),
  // Control de ingresos por tipo de entrada (dashboard de Porteros, se consulta cada 10 s)
  ingresosEvento: (id) => api.get(`/admin/event/${id}/ingresos`).then(datos),
  // Venta en portería: URLs de los QR de compra y cobro asistido en boletería
  qrCompra: (id) => api.get(`/admin/event/${id}/qr-compra`).then(datos),
  crearCobroPuerta: (d) => api.post('/admin/puerta/cobro', d).then(datos),
  estadoCobroPuerta: (idVenta) => api.get(`/admin/puerta/cobro/${idVenta}`).then(datos),
  actualizarEvento: (id, d) => api.post(`/admin/event/${id}/update`, d).then(datos),
  // Venta directa con MercadoPago desde el panel: mismo checkout único que el resto de los canales
  cobrarMercadoPago: (d) => api.post('/ventas/checkout', d).then(datos),
  // Correos con las entradas: estado por venta + links por ticket; reenviar
  correosEvento: (id) => api.get(`/admin/event/${id}/correos`).then(datos),
  reenviarCorreo: (idVenta) => api.post(`/admin/ventas/${idVenta}/reenviar-correo`).then(datos),
  // Links de descarga de cada ticket de una venta pagada: { ventaId, buyer_name, buyer_phone, tickets: [{ ticketId, link }] }
  linksVenta: (idVenta) => api.get(`/admin/ventas/links/${idVenta}`).then(datos),
};

// Links de venta del admin con stock propio (/venta/:linkId). El stock baja sólo con el pago aprobado.
export const salesLinksApi = {
  crear: (d) => api.post('/ventas/link', d).then(datos),
  listar: () => api.get('/ventas/link').then(datos),
  actualizar: (id, d) => api.patch(`/ventas/link/${id}`, d).then(datos),
  tickets: (id) => api.get(`/ventas/link/${id}/tickets`).then(datos),
  publico: (linkId) => api.get(`/publico/venta/${linkId}`, { headers: { 'X-Tenant': '' } }).then(datos),
  checkout: (d) => api.post('/ventas/checkout', d, { headers: { 'X-Tenant': '' } }).then(datos),
};

// Links de pago que el vendedor genera para un comprador: MercadoPago (por defecto) o efectivo
export const linksPagoApi = {
  generar: (d) => api.post('/links/generar', d).then(datos),
  // Sin comprador: genera el link de checkout /checkout/:linkId para enviar al cliente
  generarCheckout: ({ id_evento, id_tipo, cantidad, descripcion }) => api.post('/links/generar', { id_evento, id_tipo, cantidad, descripcion }).then(datos),
  listar: () => api.get('/links').then(datos),
};

export const publicoApi = {
  // Landing de compra rápida (QR de la puerta); tipo = slug del tipo de entrada (/comprar/123/vip)
  compraRapida: (idEvento, tipo) => api.get(`/publico/comprar/${idEvento}${tipo ? `/${tipo}` : ''}`, { headers: { 'X-Tenant': '' } }).then(datos),
  link: (codigo) => api.get(`/publico/links/${codigo}`, { headers: { 'X-Tenant': '' } }).then(datos),
  entradas: (token) => api.get(`/publico/entradas/${token}`, { headers: { 'X-Tenant': '' } }).then(datos),
  // Vuelta de MercadoPago de un link de vendedor (el comprador no tiene sesión)
  verificarPago: (token, payment_id) => api.get(`/publico/entradas/${token}/verificar-pago`, { params: { payment_id }, headers: { 'X-Tenant': '' } }).then(datos),
};

export const integracionesApi = {
  // MercadoPago del complejo (OAuth): conectar devuelve { url } de autorización de MercadoPago
  mercadoPago: () => api.get('/integraciones/mercadopago').then(datos),
  conectarMercadoPago: () => api.get('/auth/mercadopago/connect').then(datos),
  pausarMercadoPago: (activo) => api.put('/integraciones/mercadopago', { activo }).then(datos),
  probarMercadoPago: () => api.post('/integraciones/mercadopago/probar').then(datos),
  eliminarMercadoPago: () => api.delete('/integraciones/mercadopago'),
  estadoChatbot: () => api.get('/integraciones/chatbot/estado').then(datos),
  // superadmin
  mercadoPagoPlataforma: () => api.get('/integraciones/plataforma/mercadopago').then(datos),
  conectarMercadoPagoPlataforma: () => api.get('/auth/mercadopago/connect/plataforma').then(datos),
  probarMercadoPagoPlataforma: () => api.post('/integraciones/plataforma/mercadopago/probar').then(datos),
  eliminarMercadoPagoPlataforma: () => api.delete('/integraciones/plataforma/mercadopago'),
  chatbot: (idTenant) => api.get(`/integraciones/chatbot/${idTenant}`).then(datos),
  guardarChatbot: (idTenant, d) => api.put(`/integraciones/chatbot/${idTenant}`, d).then(datos),
  eliminarChatbot: (idTenant) => api.delete(`/integraciones/chatbot/${idTenant}`),
  probarChatbot: (idTenant, whatsapp) => api.post(`/integraciones/chatbot/${idTenant}/probar`, { whatsapp }).then(datos),
  conectarBaileys: (idTenant) => api.post(`/integraciones/chatbot/${idTenant}/baileys/conectar`).then(datos),
  estadoBaileys: (idTenant) => api.get(`/integraciones/chatbot/${idTenant}/baileys/estado`).then(datos),
  desconectarBaileys: (idTenant) => api.post(`/integraciones/chatbot/${idTenant}/baileys/desconectar`, { logout: true }).then(datos),
};

export const suscripcionesApi = {
  mia: () => api.get('/suscripciones/mia').then(datos),
  pagarMia: () => api.post('/suscripciones/mia/pagar').then(datos),
  planes: () => api.get('/suscripciones/planes').then(datos),
  crearPlan: (d) => api.post('/suscripciones/planes', d).then(datos),
  actualizarPlan: (id, d) => api.put(`/suscripciones/planes/${id}`, d).then(datos),
  deTenant: (idTenant) => api.get(`/suscripciones/tenant/${idTenant}`).then(datos),
  asignar: (idTenant, id_plan) => api.put(`/suscripciones/tenant/${idTenant}`, { id_plan }).then(datos),
  cobrar: (idTenant) => api.post(`/suscripciones/tenant/${idTenant}/cobrar`).then(datos),
  registrarPago: (idTenant, detalle) => api.post(`/suscripciones/tenant/${idTenant}/registrar-pago`, { detalle }).then(datos),
};

/** URL pública de una imagen subida (eventos). */
export const urlUpload = (ruta) => (ruta ? `/uploads/${ruta}` : null);

// Portería (sólo rol portero). Nunca pasa por la caché del Service Worker.
export const porteriaApi = {
  validarQR: (codigo, id_evento) => api.post('/porteria/validarQR', { codigo, id_evento }).then(datos),
  eventos: () => api.get('/porteria/eventos').then(datos),
  historial: () => api.get('/porteria/historial').then(datos),
};

// Porteros del complejo (admin). La contraseña generada sólo llega al crear o regenerar.
export const porterosApi = {
  listar: () => api.get('/porteros').then(datos),
  crear: (d) => api.post('/porteros', d).then(datos),
  actualizar: (id, d) => api.put(`/porteros/${id}`, d).then(datos),
  regenerarPassword: (id) => api.post(`/porteros/${id}/password`).then(datos),
  eliminar: (id) => api.delete(`/porteros/${id}`).then(datos),
};

// Supervisión de la puerta (admin)
export const accesoApi = {
  historial: () => api.get('/acceso/historial').then(datos),
};

export const usuariosApi = {
  listar: () => api.get('/usuarios').then(datos),
  crear: (d) => api.post('/usuarios', d).then(datos),
  actualizar: (id, d) => api.put(`/usuarios/${id}`, d).then(datos),
};

export default api;
