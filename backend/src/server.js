require('./utils/warnings'); // primero: filtra el aviso de JSON modules que emite Baileys
require('dotenv').config();
const app = require('./app');
const { expirarPendientes } = require('./controllers/ventasController');
const pool = require('./config/db');
const { baileys } = require('./services/chatbot');

for (const v of ['JWT_SECRET', 'CREDENTIALS_KEY']) {
  if (!process.env[v]) {
    console.error(`Falta ${v} en .env`);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 4000;
/** Complejos con Baileys activo: reconecta los que tienen sesión y no están abiertos en este proceso. */
const restaurarWhatsapp = () =>
  pool
    .query("SELECT id_tenant FROM chatbot_integrations WHERE provider = 'baileys' AND activo = 1")
    .then(([rows]) => baileys.restaurarSesiones(rows.map((r) => r.id_tenant).filter((id) => baileys.estadoDe(id).estado !== 'conectado')))
    .catch((e) => console.error('[baileys]', e.message));

const servidor = app.listen(PORT, () => {
  console.log(`API Integra360 Ticketera en http://localhost:${PORT}/api`);
  restaurarWhatsapp();
});

// Vigilante: si otra instancia que tenía una sesión se cae, ésta toma el lock y la reconecta
setInterval(restaurarWhatsapp, 2 * 60 * 1000);

// Apagado ordenado: cierra los sockets de WhatsApp y libera los locks para que otra instancia los tome
const apagar = async (senal) => {
  console.log(`Recibido ${senal}: cerrando…`);
  servidor.close();
  await baileys.cerrarTodo().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));

// Renueva los access tokens de MercadoPago que vencen pronto (al iniciar y cada 6 horas)
const { renovarPorVencer } = require('./services/mercadopagoTokens');
const renovarMercadoPago = () =>
  renovarPorVencer()
    .then((r) => (r.renovados || r.requierenReconexion || r.errores) && console.log('[mercadopago] renovación de tokens', r))
    .catch((e) => console.error('[mercadopago] renovación', e.message));
setTimeout(renovarMercadoPago, 10 * 1000);
setInterval(renovarMercadoPago, 6 * 60 * 60 * 1000);

// Libera el stock de ventas pendientes vencidas cada minuto
setInterval(() => expirarPendientes().catch((e) => console.error('[expirar]', e.message)), 60 * 1000);
