require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const pool = require('../src/config/db');
const { generarCodigoLink } = require('../src/utils/qr');

/**
 * Datos de prueba multi-tenant (esquema normalizado 003):
 *  - superadmin, 2 complejos con admin (tabla administradores), porteros, vendedores y eventos con imagen
 *  - compradores globales con WhatsApp, planes y suscripciones
 */
const UPLOADS = path.join(__dirname, '../uploads/eventos');

/** Genera una imagen de muestra para un evento (degradé + título). */
const imagenDeMuestra = async (titulo, desde, hasta) => {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${desde}"/><stop offset="1" stop-color="${hasta}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="980" cy="160" r="120" fill="white" fill-opacity="0.18"/><circle cx="1080" cy="480" r="200" fill="white" fill-opacity="0.08"/>
    <text x="70" y="520" font-size="96" font-family="Arial" font-weight="bold" fill="white">${titulo}</text></svg>`;
  const nombre = `eventos/${crypto.randomUUID()}.jpg`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(path.join(__dirname, '../uploads', nombre));
  return nombre;
};

(async () => {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM tenants WHERE slug IN ('norte','luna')");
  if (n > 0) {
    console.log('Los datos de prueba ya estaban sembrados');
    return pool.end();
  }

  const hash = (p) => bcrypt.hash(p, 10);
  const insertar = async (sql, params) => (await pool.query(sql, params))[0].insertId;

  // ---------- Tenants ----------
  const norte = await insertar(
    'INSERT INTO tenants (nombre, slug, email_contacto, telefono, direccion, color_primario) VALUES (?, ?, ?, ?, ?, ?)',
    ['Complejo Norte', 'norte', 'contacto@complejonorte.com', '+54 11 4000-1000', 'Av. Libertador 5000, CABA', '#4f46e5']
  );
  const luna = await insertar(
    'INSERT INTO tenants (nombre, slug, email_contacto, telefono, direccion, color_primario, mensaje_whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['Boliche Luna', 'luna', 'hola@bolicheluna.com', '+54 351 400-2000', 'Bv. San Juan 800, Córdoba', '#9333ea',
      '🌙 {nombre}, ¡nos vemos en {evento}! Tus entradas: {link}']
  );

  // ---------- Usuarios (persona) + pertenencia ----------
  const usuario = async ({ nombre, apellido = null, email, pass, rol, whatsapp = null, dni = null }) =>
    insertar('INSERT INTO usuarios (nombre, apellido, email, dni, whatsapp, password_hash, rol) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      nombre, apellido, email, dni, whatsapp, await hash(pass), rol,
    ]);
  const admin = async (idTenant, datos) => {
    const id = await usuario({ ...datos, pass: 'admin123', rol: 'admin' });
    await pool.query('INSERT INTO administradores (id_usuario, id_tenant) VALUES (?, ?)', [id, idTenant]);
  };

  await usuario({ nombre: 'Super', apellido: 'Admin', email: 'super@integra360.com', pass: 'super123', rol: 'superadmin' });
  await admin(norte, { nombre: 'Admin', apellido: 'Norte', email: 'admin@norte.com' });
  await admin(luna, { nombre: 'Admin', apellido: 'Luna', email: 'admin@luna.com' });
  await usuario({ nombre: 'Ana', apellido: 'Pérez', email: 'ana@mail.com', pass: 'user123', rol: 'comprador', whatsapp: '+5491155551111', dni: '30111222' });
  await usuario({ nombre: 'Bruno', apellido: 'Díaz', email: 'bruno@mail.com', pass: 'user123', rol: 'comprador', whatsapp: '+5493515552222', dni: '30333444' });

  // ---------- Vendedores (usuario + pertenencia + link general) ----------
  // Porteros: ingresan con usuario (sin email) y sólo acceden a /porteria
  const portero = async (idTenant, nombre, usuarioLogin) => {
    const id = await usuario({ nombre, email: null, pass: 'porton123', rol: 'portero' });
    await pool.query('INSERT INTO porteros (id_tenant, id_usuario, usuario) VALUES (?, ?, ?)', [idTenant, id, usuarioLogin]);
  };
  await portero(norte, 'Puerta Norte', 'norte.puerta');
  await portero(luna, 'Puerta Luna', 'luna.puerta');

  const vendedor = async (idTenant, nombre, apellido, dni, whatsapp, email) => {
    const idUsuario = await usuario({ nombre, apellido, email, pass: 'vende123', rol: 'vendedor', whatsapp, dni });
    const id = await insertar('INSERT INTO vendedores (id_tenant, id_usuario) VALUES (?, ?)', [idTenant, idUsuario]);
    const codigo = generarCodigoLink();
    await pool.query("INSERT INTO links_venta (id_vendedor, codigo, descripcion) VALUES (?, ?, 'Link general')", [id, codigo]);
    return codigo;
  };
  const links = {
    carla: await vendedor(norte, 'Carla', 'Gómez', '28111222', '+5491166661111', 'carla@norte.com'),
    diego: await vendedor(norte, 'Diego', 'Ruiz', '29333444', '+5491166662222', 'diego@norte.com'),
    lucia: await vendedor(luna, 'Lucía', 'Martínez', '31555666', '+5493516663333', 'lucia@luna.com'),
  };

  // ---------- Eventos Complejo Norte ----------
  const evento = async (idTenant, d, imagen) =>
    insertar(
      `INSERT INTO eventos (id_tenant, nombre, descripcion, imagen_evento, fecha, lugar, limite_por_persona, tiene_seating, estado)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?, ?)`,
      [idTenant, d.nombre, d.descripcion, imagen, d.dias, d.lugar, d.limite, d.seating ? 1 : 0, d.estado || 'publicado']
    );
  const tipo = (idEvento, nombre, precio, stock, condiciones, extra = {}) =>
    insertar(
      `INSERT INTO tipos_ticket (id_evento, nombre_tipo, precio, stock_total, stock_disponible, condiciones, venta_hasta, solo_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idEvento, nombre, precio, stock, extra.disponible ?? stock, condiciones, extra.ventaHasta || null, extra.soloAdmin ? 1 : 0]
    );

  const e1 = await evento(norte, { nombre: 'Festival Rock 360', descripcion: 'Festival al aire libre con 10 bandas', dias: 30, lugar: 'Complejo Norte - Campo', limite: 4 },
    await imagenDeMuestra('ROCK 360', '#0ea5e9', '#f97316'));
  const hasta10 = new Date(Date.now() + 10 * 864e5);
  await tipo(e1, 'Early Bird', 15000, 100, 'Precio promocional por tiempo limitado', { ventaHasta: hasta10 });
  await tipo(e1, 'General', 20000, 500, 'Acceso a campo general');
  await tipo(e1, 'VIP', 45000, 50, 'Acceso preferencial + barra libre');
  await tipo(e1, 'Invitación', 0, 20, 'Solo emitidas por administración', { soloAdmin: true });

  const e2 = await evento(norte, { nombre: 'Obra: El Gran Teatro', descripcion: 'Función con ubicación numerada', dias: 15, lugar: 'Complejo Norte - Sala 1', limite: null, seating: true },
    await imagenDeMuestra('EL GRAN TEATRO', '#7f1d1d', '#f59e0b'));
  const platea = await tipo(e2, 'Platea', 25000, 30, 'Ubicación numerada');
  const palco = await tipo(e2, 'Palco', 40000, 10, 'Palco numerado');
  const asientos = [];
  for (const fila of ['A', 'B', 'C']) for (let i = 1; i <= 10; i++) asientos.push([platea, 'Platea', fila, i]);
  for (let i = 1; i <= 10; i++) asientos.push([palco, 'Palco', 'P', i]);
  await pool.query('INSERT INTO asientos (id_tipo, sector, fila, numero) VALUES ?', [asientos]);

  // ---------- Eventos Boliche Luna ----------
  const e3 = await evento(luna, { nombre: 'Noche Electrónica', descripcion: 'DJ sets hasta el amanecer', dias: 7, lugar: 'Boliche Luna', limite: 6 },
    await imagenDeMuestra('NOCHE ELECTRÓNICA', '#312e81', '#db2777'));
  await tipo(e3, 'General', 8000, 400, 'Ingreso hasta las 2 AM');
  await tipo(e3, 'VIP Mesa', 30000, 20, 'Mesa + botella');
  const e4 = await evento(luna, { nombre: 'Fiesta Retro 90s', descripcion: 'Agotada (prueba de lista de espera)', dias: 20, lugar: 'Boliche Luna', limite: 2, estado: 'agotado' }, null);
  await tipo(e4, 'General', 6000, 5, 'Agotado', { disponible: 0 });

  // ---------- Planes y suscripciones ----------
  const basico = await insertar("INSERT INTO planes (nombre, descripcion, precio_mensual) VALUES ('Básico', 'Hasta 5 eventos por mes', 25000)");
  const pro = await insertar("INSERT INTO planes (nombre, descripcion, precio_mensual) VALUES ('Pro', 'Eventos ilimitados + vendedores ilimitados', 60000)");
  await pool.query("INSERT INTO suscripciones (id_tenant, id_plan, estado, vence_el) VALUES (?, ?, 'activa', DATE_ADD(CURDATE(), INTERVAL 20 DAY))", [norte, pro]);
  await pool.query("INSERT INTO suscripciones (id_tenant, id_plan, estado) VALUES (?, ?, 'pendiente')", [luna, basico]);

  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  console.log('Seed completado.\n');
  console.log('  Superadmin:        super@integra360.com / super123');
  console.log('  Admin Norte:       admin@norte.com / admin123');
  console.log('  Admin Luna:        admin@luna.com / admin123');
  console.log('  Vendedores:        carla@norte.com, diego@norte.com, lucia@luna.com / vende123');
  console.log('  Porteros:          norte.puerta, luna.puerta / porton123');
  console.log('  Compradores:       ana@mail.com, bruno@mail.com / user123\n');
  console.log(`  Link Carla (Norte): ${front}/v/${links.carla}`);
  console.log(`  Link Lucía (Luna):  ${front}/v/${links.lucia}`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
