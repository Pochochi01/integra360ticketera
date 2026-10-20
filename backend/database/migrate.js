require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const TABLAS = [
  'porteros', 'baileys_auth', 'pagos', 'suscripciones', 'planes', 'chatbot_integrations', 'mercadopago_oauth_estados', 'mercadopago_tokens', 'mercadopago_integrations', 'ventas_link', 'administradores',
  'mensajes_whatsapp', 'accesos', 'lista_espera', 'transferencias_ticket', 'tickets', 'ventas', 'links_venta',
  'vendedores', 'asientos', 'tipos_ticket', 'eventos', 'usuarios', 'tenants', 'migraciones',
];

/**
 * Aplica en orden los .sql de migrations/ que todavía no figuran en la tabla `migraciones`.
 * --fresh borra todas las tablas antes de migrar.
 */
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });
  const db = process.env.DB_NAME;
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${db}\``);

  if (process.argv.includes('--fresh')) {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('DROP VIEW IF EXISTS entradas, eventos_inscripciones, reservas, reservations');
    for (const t of TABLAS) await conn.query(`DROP TABLE IF EXISTS ${t}`);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    console.log('Tablas eliminadas');
  }

  const [[{ previa }]] = await conn.query(
    "SELECT COUNT(*) AS previa FROM information_schema.tables WHERE table_schema = ? AND table_name = 'migraciones'",
    [db]
  );
  await conn.query(
    'CREATE TABLE IF NOT EXISTS migraciones (nombre VARCHAR(120) PRIMARY KEY, aplicada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  );
  // Bases creadas antes de existir el registro de migraciones: 001 ya estaba aplicada
  if (!previa) {
    const [[{ existe }]] = await conn.query(
      "SELECT COUNT(*) AS existe FROM information_schema.tables WHERE table_schema = ? AND table_name = 'usuarios'",
      [db]
    );
    if (existe) await conn.query("INSERT IGNORE INTO migraciones (nombre) VALUES ('001_schema.sql')");
  }

  const [aplicadas] = await conn.query('SELECT nombre FROM migraciones');
  const hechas = new Set(aplicadas.map((r) => r.nombre));
  const dir = path.join(__dirname, 'migrations');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (hechas.has(f)) continue;
    await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await conn.query('INSERT INTO migraciones (nombre) VALUES (?)', [f]);
    console.log(`Migración aplicada: ${f}`);
  }
  console.log('Base de datos al día');
  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
