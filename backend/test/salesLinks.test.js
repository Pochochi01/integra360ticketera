/**
 * Integración de los links de venta del admin (/venta/:linkId) contra MySQL real.
 *
 * Usa una base APARTE (DB_NAME_TEST, por defecto <DB_NAME>_test) que se recrea con migrate --fresh + seed.
 * MercadoPago se simula reemplazando las funciones de services/mercadopagoService: cada cuenta se reconoce
 * por su access token y los pagos sólo existen en la cuenta que cobró (como en la API real).
 *
 *   npm test
 */
require('dotenv').config();
process.env.DB_NAME = process.env.DB_NAME_TEST || `${process.env.DB_NAME || 'integra360_ticketera'}_test`;
process.env.LINK_PUBLICO_MAX_POR_IP = '10000';
process.env.MP_CLIENT_ID ||= 'test-client';
process.env.MP_CLIENT_SECRET ||= 'test-secret';
process.env.FRONTEND_URL = 'https://tu-dominio.com';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

// ── Simulador de MercadoPago ────────────────────────────────────────────────────────────────────
const mp = require('../src/services/mercadopagoService');
const cuentaDeToken = new Map([['TOK-T1', '1001'], ['TOK-T2', '2002']]);
const preferencias = []; // { access_token, opciones, id }
const pagosMp = new Map(); // payment_id → pago
const reembolsos = [];
const renovaciones = [];
let siguienteId = 1;

mp.firmaValida = () => true;
mp.crearPreferencia = async (cred, opciones) => {
  if (!cuentaDeToken.has(cred.access_token)) throw new mp.MercadoPagoError(401, 'invalid_token');
  const id = `pref-${siguienteId++}`;
  preferencias.push({ id, access_token: cred.access_token, opciones });
  return { id, init_point: `https://mp.test/checkout/${id}`, sandbox_init_point: `https://sandbox.mp.test/checkout/${id}` };
};
mp.obtenerPago = async (cred, id) => {
  const pago = pagosMp.get(String(id));
  if (!pago || pago.collector_id !== cuentaDeToken.get(cred.access_token)) throw new mp.MercadoPagoError(404, 'Payment not found');
  return pago;
};
mp.reembolsar = async (cred, id) => { reembolsos.push({ cuenta: cuentaDeToken.get(cred.access_token), id: String(id) }); return {}; };
mp.oauthToken = async (cuerpo) => {
  renovaciones.push(cuerpo);
  const viejo = cuerpo.refresh_token;
  const nuevo = `${viejo.replace('REF', 'TOK')}-R${renovaciones.length}`;
  cuentaDeToken.set(nuevo, viejo.endsWith('T1') || viejo.includes('T1-') ? '1001' : '2002');
  return { access_token: nuevo, refresh_token: `${viejo}-R${renovaciones.length}`, expires_in: 15552000, user_id: cuentaDeToken.get(nuevo) };
};
// Sin WhatsApp en las pruebas
require('../src/services/notificaciones').enviarEntradasPorWhatsapp = async () => ({ simulado: true });
// SMTP simulado: guarda cada correo; fallarCorreo = true hace que el próximo envío falle
const correos = [];
let fallarCorreo = false;
require('../src/services/correo').setTransporte({
  sendMail: async (m) => {
    if (fallarCorreo) { fallarCorreo = false; throw new Error('SMTP caído (simulado)'); }
    correos.push(m);
    return { messageId: `m${correos.length}` };
  },
});

/** El comprador paga la preferencia en MercadoPago: el pago queda en la cuenta del token que la creó. */
const pagar = (pref, status = 'approved') => {
  const id = String(900000 + siguienteId++);
  const monto = pref.opciones.items.reduce((s, i) => s + i.quantity * Number(i.unit_price), 0);
  pagosMp.set(id, { id: Number(id), status, external_reference: pref.opciones.externalReference, transaction_amount: monto, collector_id: cuentaDeToken.get(pref.access_token) });
  return id;
};
const cambiarEstado = (id, status) => { pagosMp.get(id).status = status; };

// ── Servidor y datos ────────────────────────────────────────────────────────────────────────────
let pool, servidor, base;
const datos = {};

const api = async (metodo, ruta, { body, token } = {}) => {
  const r = await fetch(`${base}/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Tenant': '', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const webhook = (paymentId, userId) => api('POST', '/pagos/webhook', { body: { type: 'payment', action: 'payment.updated', user_id: Number(userId), data: { id: paymentId } } });

let comprador = 0;
const checkout = (linkId, extra = {}) => {
  comprador++;
  return api('POST', '/ventas/checkout', {
    body: { linkId, comprador: { nombre: `Comprador ${comprador}`, email: `comprador${comprador}@test.com`, telefono: `+54 9 11 5${String(comprador).padStart(3, '0')} 0000` }, ...extra },
  });
};
const ultimaPreferencia = () => preferencias[preferencias.length - 1];
const stock = async (id) => (await pool.query('SELECT stock_disponible FROM sales_links WHERE id = ?', [id]))[0][0].stock_disponible;
const estadoVenta = async (idVenta) => (await pool.query('SELECT estado FROM ventas WHERE id_venta = ?', [idVenta]))[0][0].estado;
const ticketDeVenta = async (idVenta) => (await pool.query('SELECT * FROM sales_link_tickets WHERE id = ?', [idVenta]))[0][0];

const crearLink = (tenant, cuerpo) => api('POST', '/ventas/link', { token: datos[tenant].token, body: { id_tipo: datos[tenant].id_tipo, ...cuerpo } });

before(async () => {
  const cwd = path.join(__dirname, '..');
  execSync('node database/migrate.js --fresh', { cwd, env: process.env, stdio: 'pipe' });
  execSync('node database/seed.js', { cwd, env: process.env, stdio: 'pipe' });

  pool = require('../src/config/db');
  const app = require('../src/app');
  const { MercadoPagoToken } = require('../src/models/MercadoPagoToken');
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;

  for (const [idTenant, sufijo] of [[1, 'T1'], [2, 'T2']]) {
    // Tipo de entrada vendible: evento publicado, futuro, sin asientos; sin límite por persona ni ventana
    const [[tipo]] = await pool.query(
      `SELECT tt.id_tipo, tt.id_evento FROM tipos_ticket tt JOIN eventos e ON e.id_evento = tt.id_evento
        WHERE e.id_tenant = ? AND e.estado = 'publicado' AND e.fecha > NOW() AND NOT e.tiene_seating AND tt.activo AND NOT tt.solo_admin
        ORDER BY tt.id_tipo LIMIT 1`, [idTenant]);
    assert.ok(tipo, `el seed debe tener un evento vendible en el complejo ${idTenant}`);
    await pool.query('UPDATE eventos SET limite_por_persona = NULL WHERE id_evento = ?', [tipo.id_evento]);
    await pool.query('UPDATE tipos_ticket SET stock_total = 500, stock_disponible = 500, venta_desde = NULL, venta_hasta = NULL WHERE id_tipo = ?', [tipo.id_tipo]);
    const [[admin]] = await pool.query('SELECT a.id_usuario, u.email FROM administradores a JOIN usuarios u USING (id_usuario) WHERE a.id_tenant = ? LIMIT 1', [idTenant]);
    assert.ok(admin, `el seed debe tener un admin en el complejo ${idTenant}`);
    const token = jwt.sign({ id_usuario: admin.id_usuario, email: admin.email, nombre: 'Admin', rol: 'admin', id_tenant: idTenant }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await MercadoPagoToken.guardarConexion(idTenant, { access_token: `TOK-${sufijo}`, refresh_token: `REF-${sufijo}`, expires_in: 15552000, user_id: cuentaDeToken.get(`TOK-${sufijo}`) }, {});
    datos[idTenant] = { ...tipo, token, mpUser: cuentaDeToken.get(`TOK-${sufijo}`) };
  }
});

after(async () => {
  servidor?.close();
  await pool?.end();
});

// ── Pruebas ─────────────────────────────────────────────────────────────────────────────────────

test('generar link: valida el complejo de la sesión y devuelve /venta/:linkId', async () => {
  const ajeno = await crearLink(1, { stock_total: 5, tenant_id: 2 });
  assert.equal(ajeno.status, 403);
  const tipoAjeno = await api('POST', '/ventas/link', { token: datos[1].token, body: { id_tipo: datos[2].id_tipo, stock_total: 5 } });
  assert.equal(tipoAjeno.status, 404, 'no puede vender entradas de otro complejo');

  const r = await crearLink(1, { stock_total: 5, precio: 1500, producto: 'Preventa redes', tenant_id: 1 });
  assert.equal(r.status, 201);
  assert.match(r.body.url, /^https:\/\/tu-dominio\.com\/venta\/[A-Za-z0-9]+$/);
  assert.equal(r.body.stock_total, 5);
  assert.equal(r.body.stock_disponible, 5);
  assert.equal(r.body.reutilizable, true);

  const publico = await api('GET', `/publico/venta/${r.body.id}`);
  assert.equal(publico.status, 200);
  assert.equal(publico.body.producto, 'Preventa redes');
  assert.equal(publico.body.disponible, true);
  assert.ok(publico.body.complejo.nombre);
});

test('link único: admite una sola venta aprobada; la segunda se reembolsa y el link queda inválido', async () => {
  const { body: link } = await crearLink(1, { stock_total: 2, reutilizable: false, precio: 1234.5 });

  const a = await checkout(link.id, { cantidad: 7 }); // la cantidad la fija el link único
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.cantidad, 2);
  assert.equal(a.body.monto_total, 2469);
  const prefA = ultimaPreferencia();
  const b = await checkout(link.id);
  assert.equal(b.status, 201, 'mientras no haya pago aprobado el link sigue disponible');
  const prefB = ultimaPreferencia();
  assert.equal(await stock(link.id), 2, 'crear la preferencia no descuenta stock');

  const pagoA = pagar(prefA);
  assert.equal((await webhook(pagoA, datos[1].mpUser)).status, 200);
  assert.equal(await stock(link.id), 0);
  assert.equal(await estadoVenta(a.body.id_venta), 'pagado');
  assert.equal((await ticketDeVenta(a.body.id_venta)).estado, 'approved');

  const pagoB = pagar(prefB);
  const rb = await webhook(pagoB, datos[1].mpUser);
  assert.equal(rb.body.estado, 'reembolsado');
  assert.equal(await estadoVenta(b.body.id_venta), 'cancelado');
  assert.deepEqual(reembolsos.at(-1), { cuenta: datos[1].mpUser, id: pagoB });
  assert.equal(await stock(link.id), 0);

  const c = await checkout(link.id);
  assert.equal(c.status, 409);
  assert.match(c.body.error, /ya fue utilizado/);
  assert.equal((await api('GET', `/publico/venta/${link.id}`)).body.motivo, 'usado');
});

test('link reutilizable: varias ventas hasta agotar stock; rejected/pending no descuentan; webhook idempotente', async () => {
  const { body: link } = await crearLink(1, { stock_total: 3, reutilizable: true });

  const a = await checkout(link.id, { cantidad: 2 });
  const prefA = ultimaPreferencia();
  const b = await checkout(link.id, { cantidad: 2 });
  const prefB = ultimaPreferencia();
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(await stock(link.id), 3);

  const pagoA = pagar(prefA);
  await webhook(pagoA, datos[1].mpUser);
  assert.equal(await stock(link.id), 1);
  await webhook(pagoA, datos[1].mpUser); // notificación repetida
  assert.equal(await stock(link.id), 1, 'una notificación repetida no descuenta dos veces');

  assert.equal((await checkout(link.id, { cantidad: 2 })).status, 409, 'no se puede pedir más que el stock restante');

  // B pagó 2 cuando sólo queda 1: se reembolsa, no se sobrevende
  await webhook(pagar(prefB), datos[1].mpUser);
  assert.equal(await estadoVenta(b.body.id_venta), 'cancelado');
  assert.equal(await stock(link.id), 1);

  const c = await checkout(link.id, { cantidad: 1 });
  const pagoC = pagar(ultimaPreferencia(), 'rejected');
  await webhook(pagoC, datos[1].mpUser);
  assert.equal((await ticketDeVenta(c.body.id_venta)).estado, 'rejected');
  assert.equal(await stock(link.id), 1, 'un pago rechazado no descuenta');
  cambiarEstado(pagoC, 'in_process');
  await webhook(pagoC, datos[1].mpUser);
  assert.equal((await ticketDeVenta(c.body.id_venta)).estado, 'pending');
  assert.equal(await stock(link.id), 1, 'un pago pendiente no descuenta');
  cambiarEstado(pagoC, 'approved');
  await webhook(pagoC, datos[1].mpUser);
  assert.equal((await ticketDeVenta(c.body.id_venta)).estado, 'approved');
  assert.equal(await stock(link.id), 0);

  const d = await checkout(link.id);
  assert.equal(d.status, 409);
  assert.match(d.body.error, /agotaron/);
  const [[{ aprobadas }]] = await pool.query("SELECT COUNT(*) AS aprobadas FROM sales_link_tickets WHERE link_id = ? AND estado = 'approved'", [link.id]);
  assert.equal(aprobadas, 2);
});

test('cada pago se acredita en la cuenta del complejo dueño del link', async () => {
  const { body: link2 } = await crearLink(2, { stock_total: 10 });
  const { body: link1 } = await crearLink(1, { stock_total: 10 });

  const v2 = await checkout(link2.id);
  const pref2 = ultimaPreferencia();
  assert.equal(pref2.access_token, 'TOK-T2', 'la preferencia se crea con el token del complejo 2');
  assert.match(pref2.opciones.notificationUrl, /\/api\/pagos\/webhook\/mercadopago\/2$/);
  assert.equal(pref2.opciones.backUrls.failure, `https://tu-dominio.com/venta/${link2.id}?pago=rechazado`);
  await checkout(link1.id);
  assert.equal(ultimaPreferencia().access_token, 'TOK-T1');

  // Checkout que intenta forzar otro complejo
  assert.equal((await checkout(link2.id, { tenant_id: 1 })).status, 403);

  const pago = pagar(pref2);
  const equivocada = await webhook(pago, datos[1].mpUser);
  assert.equal(equivocada.status, 200);
  assert.ok(equivocada.body.ignorado, 'notificado con la cuenta del otro complejo: se ignora');
  assert.equal(await stock(link2.id), 10);

  await webhook(pago, datos[2].mpUser);
  assert.equal(await stock(link2.id), 9);
  assert.equal(await estadoVenta(v2.body.id_venta), 'pagado');
});

test('el webhook por complejo (notification_url) también actualiza ticket y stock', async () => {
  const { body: link } = await crearLink(2, { stock_total: 4 });
  const v = await checkout(link.id, { cantidad: 3 });
  const pago = pagar(ultimaPreferencia());
  const r = await api('POST', `/pagos/webhook/mercadopago/2?type=payment&data.id=${pago}`, { body: {} });
  assert.equal(r.status, 200);
  assert.equal((await ticketDeVenta(v.body.id_venta)).estado, 'approved');
  assert.equal(await stock(link.id), 1);
  const [[{ validos }]] = await pool.query("SELECT COUNT(*) AS validos FROM tickets WHERE id_venta = ? AND estado = 'valido'", [v.body.id_venta]);
  assert.equal(validos, 3, 'se emiten los tickets con QR');
});

test('token por vencer: se renueva con el refresh_token antes de crear la preferencia', async () => {
  await pool.query("UPDATE mercadopago_tokens SET expira_en = NOW() + INTERVAL 1 DAY WHERE ambito = 1");
  const { body: link } = await crearLink(1, { stock_total: 2 });
  const r = await checkout(link.id);
  assert.equal(r.status, 201);
  assert.equal(renovaciones.at(-1).grant_type, 'refresh_token');
  assert.equal(renovaciones.at(-1).refresh_token, 'REF-T1');
  assert.notEqual(ultimaPreferencia().access_token, 'TOK-T1', 'usa el access token renovado');
  assert.equal(cuentaDeToken.get(ultimaPreferencia().access_token), '1001', 'sigue siendo la cuenta del complejo 1');
});

test('link pausado: la página lo informa y el checkout se rechaza', async () => {
  const { body: link } = await crearLink(1, { stock_total: 2 });
  assert.equal((await api('PATCH', `/ventas/link/${link.id}`, { token: datos[1].token, body: { activo: false } })).status, 200);
  assert.equal((await api('GET', `/publico/venta/${link.id}`)).body.motivo, 'pausado');
  assert.equal((await checkout(link.id)).status, 409);
  assert.equal((await api('PATCH', `/ventas/link/${link.id}`, { token: datos[2].token, body: { activo: true } })).status, 404, 'otro complejo no puede tocarlo');
});

test('evento agotado con stock en el link: se informa el motivo y, al subir el stock, el MISMO link vuelve a vender', async () => {
  const Evento = require('../src/models/Evento');
  const { body: link } = await crearLink(1, { stock_total: 89 });
  await pool.query('UPDATE tipos_ticket SET stock_disponible = 0 WHERE id_tipo = ?', [datos[1].id_tipo]);
  await Evento.actualizarEstadoPorStock(datos[1].id_evento);

  const agotado = await api('GET', `/publico/venta/${link.id}`);
  assert.equal(agotado.body.disponible, false);
  assert.ok(['evento_agotado', 'evento_reservado'].includes(agotado.body.motivo), agotado.body.motivo); // reservado: quedan checkouts sin pagar de pruebas anteriores
  assert.equal(agotado.body.stock_disponible, 89, 'el stock del link no cambia');
  assert.equal((await checkout(link.id)).status, 409);
  const [enLista] = (await api('GET', '/ventas/link', { token: datos[1].token })).body.filter((l) => l.id === link.id);
  assert.equal(enLista.problema, agotado.body.motivo, 'el admin ve por qué no vende');

  // El admin sube el stock del tipo en Eventos (mismo recálculo que hace eventosController.actualizarTipo)
  await pool.query('UPDATE tipos_ticket SET stock_disponible = 200 WHERE id_tipo = ?', [datos[1].id_tipo]);
  await Evento.actualizarEstadoPorStock(datos[1].id_evento);
  assert.equal((await api('GET', `/publico/venta/${link.id}`)).body.disponible, true);
  assert.equal((await checkout(link.id)).status, 201);
});

// ── Estadísticas del evento (GET /api/admin/event/:id/stats) ────────────────────────────────────

/** Cálculo independiente (JS sobre filas crudas) para comparar con el endpoint. */
const esperado = async (idEvento) => {
  const [filas] = await pool.query(
    `SELECT v.id_venta, v.estado, v.monto_total, v.id_vendedor, vsl.id_sales_link,
            (SELECT COUNT(*) FROM tickets t WHERE t.id_venta = v.id_venta AND t.estado NOT IN ('cancelado','reembolsado')) AS unidades
       FROM ventas v LEFT JOIN ventas_sales_link vsl ON vsl.id_venta = v.id_venta WHERE v.id_evento = ?`, [idEvento]);
  const pagadas = filas.filter((f) => f.estado === 'pagado' && f.unidades > 0);
  const canales = {};
  for (const f of pagadas) {
    const k = f.id_vendedor ? `vendedor:${f.id_vendedor}` : f.id_sales_link ? `link:${f.id_sales_link}` : 'directa';
    canales[k] ??= { unidades: 0, monto: 0 };
    canales[k].unidades += Number(f.unidades);
    canales[k].monto += Number(f.monto_total);
  }
  return {
    unidades: pagadas.reduce((s, f) => s + Number(f.unidades), 0),
    ingresos: pagadas.reduce((s, f) => s + Number(f.monto_total), 0),
    pendientes: filas.filter((f) => f.estado === 'pendiente' && f.unidades > 0).length,
    canales,
  };
};
const stats = (tenant, idEvento = datos[tenant].id_evento, token = datos[tenant].token) => api('GET', `/admin/event/${idEvento}/stats`, { token });

test('estadísticas: sólo administradores del complejo', async () => {
  assert.equal((await api('GET', `/admin/event/${datos[1].id_evento}/stats`)).status, 401);
  const comprador = jwt.sign({ id_usuario: 1, rol: 'comprador', id_tenant: null }, process.env.JWT_SECRET);
  assert.equal((await stats(1, datos[1].id_evento, comprador)).status, 403);
  assert.equal((await stats(2, datos[1].id_evento)).status, 404, 'el admin de otro complejo no ve el evento');
});

test('estadísticas: datos del evento y totales/por vendedor coinciden con la base', async () => {
  const r = await stats(1);
  assert.equal(r.status, 200);
  const [[ev]] = await pool.query('SELECT nombre, lugar FROM eventos WHERE id_evento = ?', [datos[1].id_evento]);
  const [[stock]] = await pool.query('SELECT SUM(stock_total) AS total, SUM(stock_disponible) AS disp FROM tipos_ticket WHERE id_evento = ?', [datos[1].id_evento]);
  assert.equal(r.body.evento.nombre, ev.nombre);
  assert.equal(r.body.evento.lugar, ev.lugar);
  assert.equal(r.body.evento.stock_total, Number(stock.total));
  assert.equal(r.body.evento.stock_disponible, Number(stock.disp));

  const e = await esperado(datos[1].id_evento);
  assert.ok(e.unidades > 0, 'las pruebas anteriores dejaron ventas aprobadas');
  assert.equal(r.body.generales.unidades, e.unidades);
  assert.equal(r.body.generales.ingresos, e.ingresos);
  assert.equal(r.body.generales.pendientes.ventas, e.pendientes);
  assert.equal(r.body.por_vendedor.length, Object.keys(e.canales).length);
  for (const c of r.body.por_vendedor) assert.deepEqual({ unidades: c.unidades, monto: c.monto }, e.canales[c.clave], c.clave);
  assert.equal(r.body.por_vendedor.reduce((s, c) => s + c.monto, 0), r.body.generales.ingresos, 'la suma por canal da el total');
  assert.equal(r.body.por_tipo.reduce((s, t) => s + t.unidades, 0), e.unidades);
  assert.ok(Array.isArray(r.body.por_dia) && Array.isArray(r.body.por_metodo));
});

test('estadísticas: reflejan el pago cuando MercadoPago lo aprueba (no antes)', async () => {
  const antes = (await stats(2)).body;
  const { body: link } = await crearLink(2, { stock_total: 5, precio: 1000 });
  await checkout(link.id, { cantidad: 2 });
  const pendiente = (await stats(2)).body;
  assert.equal(pendiente.generales.ingresos, antes.generales.ingresos, 'un checkout sin pagar no suma ingresos');
  assert.equal(pendiente.generales.pendientes.ventas, antes.generales.pendientes.ventas + 1);

  await webhook(pagar(ultimaPreferencia()), datos[2].mpUser);
  const despues = (await stats(2)).body;
  assert.equal(despues.generales.unidades, antes.generales.unidades + 2);
  assert.equal(despues.generales.ingresos, antes.generales.ingresos + 2000);
  assert.equal(despues.generales.ingresos_mercadopago, antes.generales.ingresos_mercadopago + 2000);
  const canal = despues.por_vendedor.find((c) => c.clave === `link:${link.id}`);
  assert.deepEqual({ unidades: canal.unidades, monto: canal.monto }, { unidades: 2, monto: 2000 });
  assert.equal(despues.por_metodo.find((m) => m.metodo === 'mercadopago').monto, despues.generales.ingresos_mercadopago);
});

// ── Stock uniforme por evento: se descuenta sólo con el pago aprobado, en todos los canales ─────────

const stockTipo = async (idTipo) => (await pool.query('SELECT stock_disponible FROM tipos_ticket WHERE id_tipo = ?', [idTipo]))[0][0].stock_disponible;
const estadoEvento = async (idEvento) => (await pool.query('SELECT estado FROM eventos WHERE id_evento = ?', [idEvento]))[0][0].estado;
/** Link de vendedor del complejo 1 que no fija producto (lo crea si el seed no tiene uno). */
const linkVendedor = async () => {
  const [[l]] = await pool.query(
    `SELECT l.codigo FROM links_venta l JOIN vendedores v ON v.id_vendedor = l.id_vendedor
      WHERE v.id_tenant = 1 AND v.estado = 'activo' AND l.activo AND l.id_tipo IS NULL AND l.cantidad IS NULL
        AND (l.id_evento IS NULL OR l.id_evento = ?) LIMIT 1`, [datos[1].id_evento]);
  if (l) return l.codigo;
  const [[v]] = await pool.query("SELECT id_vendedor FROM vendedores WHERE id_tenant = 1 AND estado = 'activo' LIMIT 1");
  assert.ok(v, 'el seed debe tener un vendedor activo en el complejo 1');
  await pool.query('INSERT INTO links_venta (id_vendedor, codigo, activo) VALUES (?, ?, 1)', [v.id_vendedor, 'testvend01']);
  return 'testvend01';
};
const comprar = (body) => {
  comprador++;
  return api('POST', '/ventas/checkout', { body: { comprador: { nombre: `Canal ${comprador}`, email: `canal${comprador}@test.com`, telefono: `+54 9 11 6${String(comprador).padStart(3, '0')} 0000` }, ...body } });
};
const items = (cantidad) => [{ id_tipo: datos[1].id_tipo, cantidad }];

test('los tres canales usan /api/ventas/checkout: el stock del evento baja sólo al aprobarse el pago', async () => {
  const codigo = await linkVendedor();
  const { body: link } = await crearLink(1, { stock_total: 50 });
  const canales = [
    ['directa', { event_id: datos[1].id_evento, items: items(2) }, 2],
    ['vendedor', { codigo_link: codigo, id_evento: datos[1].id_evento, items: items(3) }, 3],
    ['link_complejo', { linkId: link.id, cantidad: 2 }, 2],
  ];
  for (const [canal, cuerpo, n] of canales) {
    const antes = await stockTipo(datos[1].id_tipo);
    const r = await comprar(cuerpo);
    assert.equal(r.status, 201, `${canal}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.canal, canal);
    assert.ok(r.body.init_point);
    assert.equal(cuentaDeToken.get(ultimaPreferencia().access_token), datos[1].mpUser, `${canal}: cobra la cuenta del complejo`);
    assert.equal(await stockTipo(datos[1].id_tipo), antes, `${canal}: crear la preferencia no descuenta stock`);

    await webhook(pagar(ultimaPreferencia()), datos[1].mpUser);
    assert.equal(await stockTipo(datos[1].id_tipo), antes - n, `${canal}: el pago aprobado descuenta ${n}`);
    assert.equal(await estadoVenta(r.body.id_venta), 'pagado');
    // Sincronizado: la página pública del evento ve el mismo stock en el momento
    const publico = await api('GET', `/eventos/${datos[1].id_evento}`);
    assert.equal(publico.body.tipos.find((t) => t.id_tipo === datos[1].id_tipo).stock_disponible, antes - n);
  }
  // El alias histórico del vendedor también pasa por el checkout único
  const alias = await api('POST', '/pagos/crear', { body: { link_id: codigo, id_evento: datos[1].id_evento, items: items(1), comprador: { nombre: 'Alias', email: 'alias@test.com', telefono: '+54 9 11 6999 0000' } } });
  assert.equal(alias.status, 201, JSON.stringify(alias.body));
  assert.equal(alias.body.canal, 'vendedor');
});

test('pagos rechazados y reservas vencidas no tocan el stock del evento', async () => {
  const antes = await stockTipo(datos[1].id_tipo);
  const r = await comprar({ event_id: datos[1].id_evento, items: items(4) });
  await webhook(pagar(ultimaPreferencia(), 'rejected'), datos[1].mpUser);
  assert.equal(await stockTipo(datos[1].id_tipo), antes);
  await pool.query('UPDATE ventas SET expira_en = NOW() - INTERVAL 1 MINUTE WHERE id_venta = ?', [r.body.id_venta]);
  await require('../src/controllers/ventasController').expirarPendientes();
  assert.equal(await estadoVenta(r.body.id_venta), 'cancelado');
  assert.equal(await stockTipo(datos[1].id_tipo), antes, 'cancelar una venta que no descontó no suma stock');
});

test('stock agotado: el último cupo lo gana el primer pago aprobado y ningún canal permite vender más', async () => {
  const codigo = await linkVendedor();
  const { body: link } = await crearLink(1, { stock_total: 20 });
  // Sólo quedan 3 entradas en todo el evento
  await pool.query('UPDATE tipos_ticket SET stock_disponible = 0 WHERE id_evento = ? AND id_tipo <> ?', [datos[1].id_evento, datos[1].id_tipo]);
  await pool.query('UPDATE tipos_ticket SET stock_disponible = 3 WHERE id_tipo = ?', [datos[1].id_tipo]);

  const a = await comprar({ event_id: datos[1].id_evento, items: items(2) });
  const prefA = ultimaPreferencia();
  const b = await comprar({ codigo_link: codigo, id_evento: datos[1].id_evento, items: items(2) });
  const prefB = ultimaPreferencia();
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, 'sin pagos aprobados todavía hay 3 disponibles');

  await webhook(pagar(prefA), datos[1].mpUser);
  assert.equal(await stockTipo(datos[1].id_tipo), 1);
  const rb = await webhook(pagar(prefB), datos[1].mpUser);
  assert.equal(rb.body.estado, 'reembolsado', 'B pagó 2 y sólo queda 1: se reembolsa, no se sobrevende');
  assert.equal(await estadoVenta(b.body.id_venta), 'cancelado');
  assert.equal(await stockTipo(datos[1].id_tipo), 1);

  const c = await comprar({ linkId: link.id, cantidad: 1 });
  assert.equal(c.status, 201);
  await webhook(pagar(ultimaPreferencia()), datos[1].mpUser);
  assert.equal(await stockTipo(datos[1].id_tipo), 0);
  assert.equal(await estadoEvento(datos[1].id_evento), 'agotado');

  for (const cuerpo of [
    { event_id: datos[1].id_evento, items: items(1) },
    { codigo_link: codigo, id_evento: datos[1].id_evento, items: items(1) },
    { linkId: link.id, cantidad: 1 },
  ]) {
    const r = await comprar(cuerpo);
    assert.equal(r.status, 409, `bloqueado: ${JSON.stringify(cuerpo)} → ${JSON.stringify(r.body)}`);
  }
});

test('admin: edita el evento y agrega entradas (sin poder descontar), con auditoría; vuelve a vender', async () => {
  const id = datos[1].id_evento;
  const url = `/admin/event/${id}/update`;
  const tokenComprador = jwt.sign({ id_usuario: 1, rol: 'comprador' }, process.env.JWT_SECRET);
  assert.equal((await api('POST', url, { token: tokenComprador, body: { nombre: 'X' } })).status, 403);
  assert.equal((await api('POST', url, { token: datos[2].token, body: { nombre: 'X' } })).status, 404, 'otro complejo no edita');
  assert.equal((await api('POST', url, { token: datos[1].token, body: { agregar_stock: [{ id_tipo: datos[1].id_tipo, cantidad: -5 }] } })).status, 400);
  assert.equal((await api('POST', url, { token: datos[1].token, body: { agregar_stock: [{ id_tipo: datos[2].id_tipo, cantidad: 5 }] } })).status, 400, 'tipo de otro evento');
  assert.equal((await api('POST', url, { token: datos[1].token, body: { fecha: '2020-01-01 20:00:00' } })).status, 400);

  const [[antes]] = await pool.query('SELECT stock_total, stock_disponible FROM tipos_ticket WHERE id_tipo = ?', [datos[1].id_tipo]);
  const r = await api('POST', url, { token: datos[1].token, body: {
    nombre: 'Festival editado', lugar: 'Nuevo campo', agregar_stock: [{ id_tipo: datos[1].id_tipo, cantidad: 10 }],
  } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.nombre, 'Festival editado');
  assert.equal(r.body.lugar, 'Nuevo campo');
  const tipo = r.body.tipos.find((t) => t.id_tipo === datos[1].id_tipo);
  assert.equal(tipo.stock_total, antes.stock_total + 10);
  assert.equal(tipo.stock_disponible, antes.stock_disponible + 10);
  assert.equal(r.body.estado, 'publicado', 'deja de estar agotado');
  assert.deepEqual(r.body.auditoria.slice(0, 2).map((a) => a.accion).sort(), ['agregar_stock', 'editar_evento']);
  const agregado = r.body.auditoria.find((a) => a.accion === 'agregar_stock');
  assert.equal(agregado.detalle.cantidad, 10);
  assert.deepEqual(agregado.detalle.stock_disponible, { antes: antes.stock_disponible, despues: antes.stock_disponible + 10 });
  assert.ok(agregado.usuario);

  // Las entradas nuevas se venden por cualquier canal
  const v = await comprar({ event_id: id, items: items(1) });
  assert.equal(v.status, 201);
  await webhook(pagar(ultimaPreferencia()), datos[1].mpUser);
  assert.equal(await stockTipo(datos[1].id_tipo), antes.stock_disponible + 9);

  // Editar el cupo del tipo no puede bajar de lo vendido
  const vendidos = tipo.stock_total - tipo.stock_disponible + 1;
  const bajar = await api('PUT', `/eventos/tipos/${datos[1].id_tipo}`, { token: datos[1].token, body: { stock_total: vendidos - 1 } });
  assert.equal(bajar.status, 409);
});

// ── Links reutilizables de VENDEDORES (sales_links.seller_id) ───────────────────────────────────────

/** JWT de un vendedor activo del complejo 1 (del seed). */
const vendedor = async () => {
  const [[v]] = await pool.query(
    "SELECT vd.id_vendedor, u.id_usuario, u.email FROM vendedores vd JOIN usuarios u USING (id_usuario) WHERE vd.id_tenant = 1 AND vd.estado = 'activo' ORDER BY vd.id_vendedor LIMIT 1");
  assert.ok(v, 'el seed debe tener un vendedor activo en el complejo 1');
  return { ...v, token: jwt.sign({ id_usuario: v.id_usuario, email: v.email, nombre: 'Vendedor', rol: 'vendedor', id_tenant: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
};

test('vendedor: genera un link reutilizable que usan varios compradores; stock al aprobar y vendedor en cada ticket', async () => {
  const v = await vendedor();
  assert.equal((await api('POST', '/vendedor/sales-links', { token: v.token, body: { id_tipo: datos[1].id_tipo, stock_total: 10, tenant_id: 2 } })).status, 403);
  assert.equal((await api('POST', '/vendedor/sales-links', { token: v.token, body: { id_tipo: datos[2].id_tipo, stock_total: 10 } })).status, 404, 'no vende eventos de otro complejo');

  const r = await api('POST', '/vendedor/sales-links', { token: v.token, body: { id_tipo: datos[1].id_tipo, stock_total: 10, precio: 1 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const link = r.body;
  const [[tipo]] = await pool.query('SELECT precio FROM tipos_ticket WHERE id_tipo = ?', [datos[1].id_tipo]);
  assert.equal(link.precio, Number(tipo.precio), 'el vendedor vende al precio de lista (no puede fijar uno propio)');
  assert.equal(link.seller_id, v.id_vendedor);
  assert.match(link.url, /\/venta\/[A-Za-z0-9]+$/);
  assert.ok((await api('GET', `/publico/venta/${link.id}`)).body.vendedor, 'la página muestra quién atiende');

  // Varios compradores con el mismo link
  const stockEvento = await stockTipo(datos[1].id_tipo);
  const compras = [];
  for (const cantidad of [2, 1, 3]) {
    const c = await comprar({ linkId: link.id, cantidad });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(cuentaDeToken.get(ultimaPreferencia().access_token), datos[1].mpUser, 'cobra la cuenta del complejo');
    compras.push({ ...c.body, pref: ultimaPreferencia(), cantidad });
  }
  assert.equal(await stock(link.id), 10, 'crear preferencias no descuenta el stock del link');
  assert.equal(await stockTipo(datos[1].id_tipo), stockEvento, 'ni el del evento');

  await webhook(pagar(compras[0].pref), datos[1].mpUser);
  await webhook(pagar(compras[1].pref, 'rejected'), datos[1].mpUser);
  await webhook(pagar(compras[2].pref), datos[1].mpUser);
  assert.equal(await stock(link.id), 10 - 2 - 3);
  assert.equal(await stockTipo(datos[1].id_tipo), stockEvento - 5);

  // El vendedor queda identificado en cada venta y en cada ticket
  for (const c of compras) {
    const [[venta]] = await pool.query('SELECT id_vendedor FROM ventas WHERE id_venta = ?', [c.id_venta]);
    assert.equal(venta.id_vendedor, v.id_vendedor);
    const [tickets] = await pool.query('SELECT seller_id, event_id, buyer_email, buyer_phone, monto FROM tickets_detalle WHERE venta_id = ?', [c.id_venta]);
    assert.equal(tickets.length, c.cantidad);
    for (const t of tickets) {
      assert.equal(t.seller_id, v.id_vendedor);
      assert.equal(t.event_id, datos[1].id_evento);
      assert.ok(t.buyer_email && t.buyer_phone);
      assert.equal(Number(t.monto), Number(tipo.precio));
    }
  }
  // Cuenta en las estadísticas del evento como venta del vendedor
  const st = (await stats(1)).body;
  assert.ok(st.por_vendedor.find((c) => c.clave === `vendedor:${v.id_vendedor}`)?.unidades >= 5);
});

test('vendedor: «Mis ventas» filtra por estado del pago y trae el teléfono para WhatsApp', async () => {
  const v = await vendedor();
  const todas = (await api('GET', '/vendedor/ventas', { token: v.token })).body;
  assert.ok(todas.length >= 3);
  for (const estado of ['approved', 'pending', 'rejected']) {
    const r = await api('GET', `/vendedor/ventas?estado_pago=${estado}`, { token: v.token });
    assert.equal(r.status, 200);
    assert.ok(r.body.every((x) => x.estado_pago === estado), estado);
    assert.equal(r.body.length, todas.filter((x) => x.estado_pago === estado).length);
  }
  assert.ok(todas.some((x) => x.estado_pago === 'rejected'), 'el pago rechazado de la prueba anterior figura como rejected');
  assert.ok(todas.every((x) => !x.whatsapp || /^\+\d{8,15}$/.test(x.whatsapp)), 'teléfono completo en E.164 para wa.me');
  assert.equal((await api('GET', '/vendedor/ventas?estado_pago=otro', { token: v.token })).status, 400);
});

test('vendedor: sólo administra sus links; el admin los ve; vendedor inactivo → el link deja de vender', async () => {
  const v = await vendedor();
  const { body: deAdmin } = await crearLink(1, { stock_total: 5 });
  assert.equal((await api('PATCH', `/vendedor/sales-links/${deAdmin.id}`, { token: v.token, body: { activo: false } })).status, 404, 'no pausa links del admin');
  const { body: propio } = await api('POST', '/vendedor/sales-links', { token: v.token, body: { id_tipo: datos[1].id_tipo, stock_total: 5 } });
  const mios = (await api('GET', '/vendedor/sales-links', { token: v.token })).body;
  assert.ok(mios.every((l) => l.seller_id === v.id_vendedor) && mios.some((l) => l.id === propio.id));
  const delAdmin = (await api('GET', '/ventas/link', { token: datos[1].token })).body.find((l) => l.id === propio.id);
  assert.ok(delAdmin?.vendedor, 'el admin ve el link con el nombre del vendedor');

  await pool.query("UPDATE vendedores SET estado = 'inactivo' WHERE id_vendedor = ?", [v.id_vendedor]);
  try {
    assert.equal((await comprar({ linkId: propio.id })).status, 409);
    assert.equal((await api('GET', `/publico/venta/${propio.id}`)).body.motivo, 'pausado');
  } finally {
    await pool.query("UPDATE vendedores SET estado = 'activo' WHERE id_vendedor = ?", [v.id_vendedor]);
  }
  assert.equal((await comprar({ linkId: propio.id })).status, 201);
});

// ── Entradas por correo: un link de descarga único por ticket ───────────────────────────────────────

const linksDelCorreo = (m) => [...new Set(m.text.match(/https?:\/\/\S+\/api\/publico\/tickets\/[a-f0-9]{40}\/descargar/g) || [])];
const descargar = async (url) => fetch(`${base}${new URL(url).pathname}`);
const estadoCorreoTickets = async (idVenta) =>
  (await pool.query('SELECT email_status, email_sent_at, email_error, token_descarga FROM tickets WHERE id_venta = ? ORDER BY id_ticket', [idVenta]))[0];
/** Las pruebas anteriores pueden haber agotado el evento: el admin agrega entradas (POST /admin/event/:id/update). */
const asegurarStock = async (minimo) => {
  const disponible = await stockTipo(datos[1].id_tipo);
  if (disponible >= minimo) return;
  const r = await api('POST', `/admin/event/${datos[1].id_evento}/update`, { token: datos[1].token, body: { agregar_stock: [{ id_tipo: datos[1].id_tipo, cantidad: 100 }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
};
/** Compra directa de n entradas, aprobada por webhook. Devuelve la venta y el email del comprador. */
const compraAprobada = async (n) => {
  await asegurarStock(n + 10);
  const r = await comprar({ event_id: datos[1].id_evento, items: items(n) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const email = `canal${comprador}@test.com`;
  await webhook(pagar(ultimaPreferencia()), datos[1].mpUser);
  return { ...r.body, email };
};

test('correo: una entrada → un link; varias → un link único por ticket; sólo con el pago aprobado', async () => {
  await asegurarStock(20);
  // Sin pago aprobado no sale ningún correo
  const antesDeCrear = correos.length;
  const pendiente = await comprar({ event_id: datos[1].id_evento, items: items(1) });
  assert.equal(correos.length, antesDeCrear, 'crear la preferencia no envía correo');
  assert.equal((await estadoCorreoTickets(pendiente.body.id_venta))[0].email_status, null);

  const stockAntes = await stockTipo(datos[1].id_tipo);
  const una = await compraAprobada(1);
  assert.equal(await stockTipo(datos[1].id_tipo), stockAntes - 1, 'el stock baja al aprobarse');
  const m1 = correos.at(-1);
  assert.equal(m1.to, una.email);
  assert.match(m1.subject, /Tus entradas/);
  assert.equal(linksDelCorreo(m1).length, 1);
  const [t1] = await estadoCorreoTickets(una.id_venta);
  assert.equal(t1.email_status, 'sent');
  assert.ok(t1.email_sent_at);

  const tres = await compraAprobada(3);
  const m3 = correos.at(-1);
  const links = linksDelCorreo(m3);
  assert.equal(links.length, 3, '3 entradas → 3 links distintos');
  assert.ok((await estadoCorreoTickets(tres.id_venta)).every((t) => t.email_status === 'sent'));
  for (const url of links) assert.ok(m3.html.includes(url), 'los mismos links van en la versión HTML');

  // Cada link descarga su propia entrada (PNG con su QR), como archivo
  for (const url of links) {
    const r = await descargar(url);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="entrada-\d+\.png"/);
  }
  const archivos = await Promise.all(links.map(async (u) => (await descargar(u)).headers.get('content-disposition')));
  assert.equal(new Set(archivos).size, 3, 'cada link corresponde a un ticket distinto');

  // Una notificación repetida de MercadoPago no reenvía el correo
  const total = correos.length;
  const [[{ referencia_externa: idPagoMp }]] = await pool.query("SELECT referencia_externa FROM pagos WHERE id_venta = ? AND estado = 'aprobado'", [tres.id_venta]);
  await webhook(idPagoMp, datos[1].mpUser);
  assert.equal(correos.length, total);

  // Un ticket reembolsado deja de descargarse
  await pool.query("UPDATE tickets SET estado = 'reembolsado' WHERE token_descarga = ?", [new URL(links[0]).pathname.split('/')[4]]);
  assert.equal((await descargar(links[0])).status, 404);
  assert.equal((await fetch(`${base}/api/publico/tickets/${'0'.repeat(40)}/descargar`)).status, 404);
});

test('correo: si falla queda «failed»; el admin lo ve en el evento y lo reenvía', async () => {
  fallarCorreo = true;
  const venta = await compraAprobada(2);
  const estados = await estadoCorreoTickets(venta.id_venta);
  assert.ok(estados.every((t) => t.email_status === 'failed'));
  assert.match(estados[0].email_error, /SMTP caído/);
  assert.equal(await estadoVenta(venta.id_venta), 'pagado', 'un correo fallido no afecta la venta');

  const lista = await api('GET', `/admin/event/${datos[1].id_evento}/correos`, { token: datos[1].token });
  assert.equal(lista.status, 200);
  const fila = lista.body.find((v) => v.id_venta === venta.id_venta);
  assert.equal(fila.estado_correo, 'failed');
  assert.match(fila.correo_error, /SMTP caído/);
  assert.equal(fila.tickets_links.length, 2, 'el admin tiene los links para mandarlos por WhatsApp');
  assert.ok(fila.whatsapp && fila.email);
  assert.equal((await api('GET', `/admin/event/${datos[1].id_evento}/correos`, { token: datos[2].token })).body.length, 0, 'otro complejo no ve nada');

  assert.equal((await api('POST', `/admin/ventas/${venta.id_venta}/reenviar-correo`, { token: datos[2].token })).status, 404);
  const reenvio = await api('POST', `/admin/ventas/${venta.id_venta}/reenviar-correo`, { token: datos[1].token });
  assert.equal(reenvio.status, 200);
  assert.equal(reenvio.body.estado, 'sent');
  assert.deepEqual(linksDelCorreo(correos.at(-1)), fila.tickets_links.map((t) => t.url), 'reenvía los mismos links');
  assert.ok((await estadoCorreoTickets(venta.id_venta)).every((t) => t.email_status === 'sent'));
});

test('correo: el vendedor ve el estado y los links sólo de sus compradores y puede reenviar los suyos', async () => {
  const v = await vendedor();
  await asegurarStock(20);
  const { body: link } = await api('POST', '/vendedor/sales-links', { token: v.token, body: { id_tipo: datos[1].id_tipo, stock_total: 5 } });
  const c = await comprar({ linkId: link.id, cantidad: 2 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  await webhook(pagar(ultimaPreferencia()), datos[1].mpUser);

  const ventas = (await api('GET', '/vendedor/ventas?estado_pago=approved', { token: v.token })).body;
  const propia = ventas.find((x) => x.id_venta === c.body.id_venta);
  assert.equal(propia.estado_correo, 'sent');
  assert.equal(propia.tickets_links.length, 2);
  const [[{ id_vendedor: dueno }]] = await pool.query('SELECT id_vendedor FROM ventas WHERE id_venta = ?', [c.body.id_venta]);
  assert.equal(dueno, v.id_vendedor);

  assert.equal((await api('POST', `/vendedor/ventas/${c.body.id_venta}/reenviar-correo`, { token: v.token })).body.estado, 'sent');
  const ajena = await compraAprobada(1); // venta directa, sin vendedor
  assert.equal((await api('POST', `/vendedor/ventas/${ajena.id_venta}/reenviar-correo`, { token: v.token })).status, 404);
  assert.ok(!ventas.some((x) => x.id_venta === ajena.id_venta));
});

