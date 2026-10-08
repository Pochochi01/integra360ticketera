const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pool = require('../../config/db');
const { Chatbot } = require('../../models/Integracion');
const { useMySQLAuthState, borrarSesion, tieneSesion, SesionCorruptaError } = require('./authStateMySQL');

/**
 * Sesiones de WhatsApp Web (Baileys 7) — una por complejo.
 *
 * Flujo de conexión y recuperación (ver README → "WhatsApp con Baileys: reconexión"):
 *  1. Lock:   GET_LOCK de MySQL por tenant. Sólo UN proceso puede tener abierta la sesión de un complejo
 *             (dos sockets con las mismas claves desincronizan los ratchets Signal → "Bad MAC").
 *  2. Auth:   credenciales y claves en MySQL (tabla baileys_auth, cifradas). Si están dañadas → regenerar.
 *  3. Socket: getMessage + msgRetryCounterCache persistentes entre reconexiones, para que la recuperación
 *             nativa de Baileys (retry receipts + recreación de sesión) funcione.
 *  4. Descifrado: cada mensaje que llega como CIPHERTEXT ("Bad MAC", "No matching sessions"…) borra la sesión
 *             Signal de ESE contacto (se renegocia sola). Si los fallos son masivos, la sesión completa se
 *             considera corrupta y se regenera (credenciales nuevas + QR).
 *  5. Cortes: según DisconnectReason → reconexión inmediata, reconexión con backoff exponencial,
 *             regeneración con QR nuevo, o detención (sesión reemplazada / número bloqueado).
 */

const sesiones = new Map(); // idTenant → estado en memoria
const cachesReintento = new Map(); // idTenant → CacheStore (sobrevive a reconexiones)
const mensajesEnviados = new Map(); // idTenant → Map(id → proto.IMessage) para getMessage

const BACKOFF_MIN = 2_000;
const BACKOFF_MAX = 60_000;
const VENTANA_ERRORES = 10 * 60_000;
const UMBRAL_ERRORES = 15; // fallos de descifrado en la ventana…
const UMBRAL_CONTACTOS = 5; // …de al menos N contactos distintos → sesión corrupta
const MAX_MENSAJES_CACHE = 500;
const PING_LOCK = 5 * 60_000;
const ERRORES_DESCIFRADO = /Bad MAC|No matching sessions|No session record|No session found|Invalid PreKey|Key used already|MessageCounterError/i;

let baileys;
const cargar = async () => (baileys ??= await import('baileys'));
const logger = require('pino')({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });
const log = (idTenant, ...m) => console.log(`[baileys:${idTenant}]`, ...m);

// libsignal imprime con console.* cada fallo de descifrado (con stack) y cada cierre de sesión (con el objeto
// completo). Esos casos los manejamos por evento, así que se filtran sólo esos mensajes exactos.
const RUIDO_LIBSIGNAL = /^(Session error:Error: (Bad MAC|No matching sessions)|Failed to decrypt message with any known session|Closing session:|Closing open session in favor of incoming prekey bundle|Decrypted message with closed session)/;
for (const nivel of ['error', 'warn', 'info']) {
  const original = console[nivel].bind(console);
  console[nivel] = (primero, ...resto) => (typeof primero === 'string' && RUIDO_LIBSIGNAL.test(primero) ? undefined : original(primero, ...resto));
}

// ---------------------------------------------------------------- utilidades

/** CacheStore mínimo (interfaz que espera Baileys) con tope de tamaño. */
const crearCache = (max = 1000) => {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
    },
    del: (k) => m.delete(k),
    flushAll: () => m.clear(),
  };
};

const estadoPublico = (s) => (s ? { estado: s.estado, qr: s.qr } : { estado: 'desconectado', qr: null });
const estadoDe = (idTenant) => estadoPublico(sesiones.get(Number(idTenant)));

/** Estados en memoria → estado persistido ('conectando' es transitorio y no se guarda). */
const ESTADO_PERSISTIDO = { desconectado: 'desconectado', esperando_qr: 'esperando_qr', conectado: 'conectado', error: 'error', en_otra_instancia: 'error' };

const guardarEstado = (idTenant, estado, error) => {
  const persistido = ESTADO_PERSISTIDO[estado];
  if (!persistido) return Promise.resolve();
  return Chatbot.setEstado(idTenant, persistido, error).catch(() => {});
};

/** Lock distribuido por complejo: una conexión dedicada del pool mantiene GET_LOCK mientras la sesión vive. */
const adquirirLock = async (idTenant) => {
  const conn = await pool.getConnection();
  try {
    const [[{ ok }]] = await conn.query('SELECT GET_LOCK(?, 0) AS ok', [`integra360_baileys_${idTenant}`]);
    if (ok === 1) return conn;
  } catch (err) {
    conn.release();
    throw err;
  }
  conn.release();
  return null;
};

const liberarLock = async (s) => {
  if (!s?.lock) return;
  clearInterval(s.pingLock);
  try {
    await s.lock.query('SELECT RELEASE_LOCK(?)', [`integra360_baileys_${s.idTenant}`]);
  } catch {
    /* la conexión ya estaba cerrada: MySQL libera el lock solo */
  }
  s.lock.release();
  s.lock = null;
};

const cerrarSocket = (s) => {
  if (!s?.sock) return;
  s.sock.ev?.removeAllListeners();
  try {
    s.sock.end?.(undefined);
  } catch {
    /* ya cerrado */
  }
  s.sock = null;
};

// ---------------------------------------------------------------- conexión

/**
 * Abre (o reabre) la sesión del complejo. Idempotente: si ya está conectando/conectada devuelve el estado.
 * Si otra instancia del backend tiene la sesión, no conecta (estado "en_otra_instancia").
 */
const conectar = async (idTenant) => {
  idTenant = Number(idTenant);
  let s = sesiones.get(idTenant);
  if (s?.sock && ['conectando', 'esperando_qr', 'conectado'].includes(s.estado)) return estadoPublico(s);

  if (!s) {
    s = { idTenant, estado: 'conectando', qr: null, intentos: 0, fallos: [], lock: null, sock: null, detenida: false };
    sesiones.set(idTenant, s);
  }
  s.detenida = false;
  clearTimeout(s.timerReconexion);

  if (!s.lock) {
    s.lock = await adquirirLock(idTenant);
    if (!s.lock) {
      s.estado = 'en_otra_instancia';
      await guardarEstado(idTenant, 'en_otra_instancia', 'La sesión está abierta en otra instancia del servidor');
      log(idTenant, 'la sesión la tiene otra instancia; no se conecta desde este proceso');
      return estadoPublico(s);
    }
    // Mantiene viva la conexión del lock (si MySQL la corta por inactividad, el lock se perdería)
    s.pingLock = setInterval(() => s.lock?.query('SELECT 1').catch(() => reconectar(idTenant, 'se perdió el lock de MySQL')), PING_LOCK);
  }

  const b = await cargar();
  let auth;
  try {
    auth = await useMySQLAuthState(idTenant, b);
  } catch (err) {
    if (!(err instanceof SesionCorruptaError)) throw err;
    log(idTenant, err.message, '→ se regeneran credenciales');
    await registrarRegeneracion(idTenant, err.message);
    await borrarSesion(idTenant);
    auth = await useMySQLAuthState(idTenant, b);
  }

  const { version } = await b.fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  if (!cachesReintento.has(idTenant)) cachesReintento.set(idTenant, crearCache());
  if (!mensajesEnviados.has(idTenant)) mensajesEnviados.set(idTenant, new Map());

  s.estado = 'conectando';
  s.qr = null;
  s.sesionNueva = !auth.existe;
  const sock = b.default({
    auth: { creds: auth.state.creds, keys: b.makeCacheableSignalKeyStore(auth.state.keys, logger) },
    logger,
    browser: ['Integra360', 'Chrome', '1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    msgRetryCounterCache: cachesReintento.get(idTenant),
    // Para reenviar un mensaje cuando el destinatario pide reintento (no pudo descifrarlo)
    getMessage: async (key) => mensajesEnviados.get(idTenant)?.get(key.id),
    ...(version && { version }),
  });
  s.sock = sock;

  sock.ev.on('creds.update', () => auth.saveCreds().catch((e) => log(idTenant, 'no se pudieron guardar las credenciales:', e.message)));

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (s.sock !== sock) return; // evento de un socket ya reemplazado
    if (qr) {
      s.qr = await QRCode.toDataURL(qr, { width: 300, margin: 1 });
      s.estado = 'esperando_qr';
      await guardarEstado(idTenant, 'esperando_qr');
    }
    if (connection === 'open') {
      s.qr = null;
      s.estado = 'conectado';
      s.intentos = 0;
      s.fallos = [];
      log(idTenant, 'conectado');
      await pool.query("UPDATE chatbot_integrations SET estado = 'conectado', ultimo_error = NULL, conectado_en = NOW() WHERE id_tenant = ?", [idTenant]).catch(() => {});
    }
    if (connection === 'close') await manejarCierre(idTenant, sock, lastDisconnect?.error);
  });

  // Mensajes entrantes que no se pudieron descifrar llegan como stub CIPHERTEXT
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages) {
      const motivo = m.messageStubParameters?.[0];
      if (m.messageStubType === b.proto.WebMessageInfo.StubType.CIPHERTEXT && ERRORES_DESCIFRADO.test(motivo || '')) {
        manejarErrorDescifrado(idTenant, m.key, motivo).catch((e) => log(idTenant, 'error manejando fallo de descifrado:', e.message));
      }
    }
  });

  return estadoPublico(s);
};

/** Clasifica un cierre de conexión según DisconnectReason y decide la acción. */
const accionPorCierre = (codigo, DR) => {
  switch (codigo) {
    case DR.restartRequired:
      return 'reconectar_ya'; // normal justo después de escanear el QR
    case DR.loggedOut:
    case DR.badSession:
    case DR.multideviceMismatch:
      return 'regenerar'; // credenciales inválidas: sesión nueva + QR
    case DR.connectionReplaced:
      return 'detener_reemplazada'; // otra conexión con las mismas credenciales
    case DR.forbidden:
      return 'detener_bloqueado'; // número bloqueado por WhatsApp
    default:
      return 'reconectar_backoff'; // 408/428/503/red caída/desconocido
  }
};

const manejarCierre = async (idTenant, sock, error) => {
  const s = sesiones.get(idTenant);
  if (!s || s.sock !== sock) return;
  s.sock = null;
  if (s.detenida) return;
  const { DisconnectReason } = await cargar();
  const codigo = error?.output?.statusCode;
  // Un "Bad MAC" / sesión inválida al abrir la conexión también indica credenciales dañadas
  const accion = error instanceof SesionCorruptaError || /Bad MAC|bad-mac/i.test(error?.message || '') ? 'regenerar' : accionPorCierre(codigo, DisconnectReason);
  log(idTenant, `conexión cerrada (${codigo ?? error?.message ?? 'sin código'}) → ${accion}`);

  if (accion === 'reconectar_ya') return reconectar(idTenant, 'reinicio requerido', 0);
  if (accion === 'reconectar_backoff') return reconectar(idTenant, error?.message || `código ${codigo}`);
  if (accion === 'regenerar') return regenerar(idTenant, codigo === DisconnectReason.loggedOut ? 'Se cerró la sesión desde el teléfono' : `Sesión inválida (${codigo ?? error?.message})`);

  s.estado = accion === 'detener_bloqueado' ? 'error' : 'en_otra_instancia';
  const mensaje = accion === 'detener_bloqueado' ? 'WhatsApp bloqueó el número del complejo' : 'La sesión se abrió en otra conexión (reemplazada)';
  await guardarEstado(idTenant, 'error', mensaje);
  await liberarLock(s);
};

/** Reintenta con backoff exponencial + jitter (2 s → 60 s máx.). Sin límite de intentos: se recupera sola. */
const reconectar = (idTenant, motivo, demora) => {
  const s = sesiones.get(idTenant);
  if (!s || s.detenida) return;
  cerrarSocket(s);
  const espera = demora ?? Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** s.intentos) + Math.floor(Math.random() * 1000);
  s.intentos++;
  s.estado = 'conectando';
  s.qr = null; // el QR anterior ya no sirve: el socket nuevo emitirá otro
  log(idTenant, `reconexión #${s.intentos} en ${Math.round(espera / 1000)} s (${motivo})`);
  clearTimeout(s.timerReconexion);
  s.timerReconexion = setTimeout(() => {
    conectar(idTenant).catch((e) => {
      guardarEstado(idTenant, 'error', e.message);
      reconectar(idTenant, e.message);
    });
  }, espera);
};

const registrarRegeneracion = (idTenant, motivo) =>
  pool.query('UPDATE chatbot_integrations SET regeneraciones = regeneraciones + 1, ultimo_error = ? WHERE id_tenant = ?', [String(motivo).slice(0, 255), idTenant]).catch(() => {});

/**
 * Sesión corrupta o cerrada: borra credenciales y claves, limpia cachés y abre una sesión nueva,
 * que emite un QR para volver a vincular el teléfono.
 */
const regenerar = async (idTenant, motivo) => {
  const s = sesiones.get(idTenant);
  log(idTenant, `regenerando sesión: ${motivo}`);
  if (s) {
    cerrarSocket(s);
    s.intentos = 0;
    s.fallos = [];
    s.qr = null;
    s.estado = 'conectando';
  }
  await registrarRegeneracion(idTenant, motivo);
  await borrarSesion(idTenant);
  cachesReintento.get(idTenant)?.flushAll();
  mensajesEnviados.get(idTenant)?.clear();
  if (s?.detenida) return;
  return conectar(idTenant);
};

/**
 * Un mensaje entrante no se pudo descifrar ("Bad MAC", etc.):
 *  - se borra la sesión Signal de ese contacto → Baileys pide reintento y se negocia una sesión nueva;
 *  - si en 10 min hay ≥15 fallos de ≥5 contactos distintos, el problema es la sesión propia → regenerar.
 */
const manejarErrorDescifrado = async (idTenant, key, motivo) => {
  const s = sesiones.get(idTenant);
  if (!s?.sock) return;
  const jid = key.participant || key.remoteJid;
  const ahora = Date.now();
  s.fallos = s.fallos.filter((f) => ahora - f.ts < VENTANA_ERRORES).concat({ ts: ahora, jid });
  await pool.query('UPDATE chatbot_integrations SET errores_descifrado = errores_descifrado + 1 WHERE id_tenant = ?', [idTenant]).catch(() => {});

  const contactos = new Set(s.fallos.map((f) => f.jid)).size;
  if (s.fallos.length >= UMBRAL_ERRORES && contactos >= UMBRAL_CONTACTOS) {
    return regenerar(idTenant, `Sesión corrupta: ${s.fallos.length} errores de descifrado de ${contactos} contactos`);
  }
  if (jid && s.sock.signalRepository?.deleteSession) {
    await s.sock.signalRepository.deleteSession([jid]);
    log(idTenant, `"${motivo}" de ${jid}: sesión del contacto reiniciada (${s.fallos.length} en 10 min)`);
  }
};

// ---------------------------------------------------------------- API del servicio

/** Detiene la sesión. logout=true además desvincula el teléfono y borra credenciales y claves. */
const desconectar = async (idTenant, { logout = false } = {}) => {
  idTenant = Number(idTenant);
  const s = sesiones.get(idTenant);
  if (s) {
    s.detenida = true;
    clearTimeout(s.timerReconexion);
    if (logout && s.sock) await s.sock.logout().catch(() => {});
    cerrarSocket(s);
    await liberarLock(s);
    sesiones.delete(idTenant);
  }
  if (logout) {
    await borrarSesion(idTenant);
    cachesReintento.delete(idTenant);
    mensajesEnviados.delete(idTenant);
  }
  await guardarEstado(idTenant, 'desconectado', null);
};

const jid = (e164) => `${e164.replace('+', '')}@s.whatsapp.net`;

const socketConectado = (idTenant) => {
  const s = sesiones.get(Number(idTenant));
  if (s?.estado === 'en_otra_instancia') throw new Error('La sesión de WhatsApp está abierta en otra instancia del servidor');
  if (s?.estado !== 'conectado' || !s.sock) throw new Error('La sesión de WhatsApp (Baileys) no está conectada');
  return s.sock;
};

/** Verifica que el número tenga cuenta de WhatsApp (null si no hay sesión conectada). */
const existeEnWhatsapp = async (idTenant, e164) => {
  const s = sesiones.get(Number(idTenant));
  if (s?.estado !== 'conectado' || !s.sock) return null;
  const [r] = (await s.sock.onWhatsApp(jid(e164))) || [];
  return !!r?.exists;
};

const enviar = async (idTenant, destino, { cuerpo }) => {
  const sock = socketConectado(idTenant);
  const r = await sock.sendMessage(jid(destino), { text: cuerpo });
  // Se conserva el contenido por si el destinatario pide reintento (getMessage)
  const cache = mensajesEnviados.get(Number(idTenant));
  if (r?.key?.id && cache) {
    cache.set(r.key.id, r.message);
    if (cache.size > MAX_MENSAJES_CACHE) cache.delete(cache.keys().next().value);
  }
  return { id: r?.key?.id || null };
};

/**
 * Al iniciar el servidor: reconecta los complejos que tienen sesión vinculada en la base.
 * Las sesiones viejas en archivos (sessions/tenant_X, formato anterior) no se importan: eran la causa de las
 * claves desincronizadas; se renombran a *.legacy y el complejo vuelve a vincularse con un QR nuevo.
 */
const restaurarSesiones = async (idsTenant) => {
  const dirLegacy = path.resolve(process.env.BAILEYS_SESSIONS_DIR || path.join(__dirname, '../../../sessions'));
  for (const id of idsTenant) {
    const legacy = path.join(dirLegacy, `tenant_${id}`);
    if (fs.existsSync(legacy)) {
      fs.renameSync(legacy, `${legacy}.legacy-${Date.now()}`);
      log(id, 'sesión en archivos (formato anterior) archivada; se pedirá un QR nuevo');
      await guardarEstado(id, 'desconectado', 'Sesión migrada: volvé a vincular el teléfono');
      continue;
    }
    if (await tieneSesion(id)) conectar(id).catch((e) => guardarEstado(id, 'error', e.message));
  }
};

/** Cierra todo ordenadamente (señales de apagado): libera los locks para que otra instancia tome las sesiones. */
const cerrarTodo = async () => {
  for (const s of sesiones.values()) {
    s.detenida = true;
    clearTimeout(s.timerReconexion);
    cerrarSocket(s);
    await liberarLock(s);
  }
  sesiones.clear();
};

module.exports = {
  nombre: 'baileys',
  conectar,
  desconectar,
  enviar,
  estadoDe,
  existeEnWhatsapp,
  restaurarSesiones,
  cerrarTodo,
  // expuestos para pruebas / diagnóstico
  _interno: { accionPorCierre, manejarErrorDescifrado, manejarCierre, regenerar, sesiones, crearCache, UMBRAL_ERRORES, UMBRAL_CONTACTOS },
};
