import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Camera, CameraRotate, CameraSlash, CheckCircle, Flashlight, Keyboard, LockKey, Prohibit, StopCircle, WarningCircle, WifiSlash,
} from '@phosphor-icons/react';
import { mensajeError, porteriaApi } from '../../api/client';

/**
 * Lector QR de la Portería.
 *
 * 1. Abre la cámara con navigator.mediaDevices.getUserMedia (el navegador pide permiso la primera vez).
 * 2. Copia cada frame del video a un canvas reducido y lo pasa a jsQR (~8 lecturas por segundo).
 * 3. Envía el código a POST /api/porteria/validarQR y muestra el resultado sobre el video.
 * 4. Siempre ofrece cargar el código a mano (sin cámara, permiso negado o lector de códigos USB).
 *
 * Resultado binario de un vistazo: verde = entrada permitida, rojo = entrada denegada (el motivo va debajo).
 * Colores con contraste AA sobre texto blanco.
 */
export const ESTILO_RESULTADO = {
  ingresado: { caja: 'bg-emerald-700', punto: 'bg-emerald-500', icono: CheckCircle, titulo: 'Entrada permitida', detalle: 'Ingresó' },
  ya_usado: { caja: 'bg-rose-700', punto: 'bg-rose-500', icono: Prohibit, titulo: 'Entrada denegada', detalle: 'Ya usada' },
  invalido: { caja: 'bg-rose-700', punto: 'bg-rose-500', icono: Prohibit, titulo: 'Entrada denegada', detalle: 'Inválida' },
};

const ANCHO_ANALISIS = 640; // los frames se reducen a este ancho: suficiente para un QR y liviano en celulares
const INTERVALO_MS = 125;
const MISMO_CODIGO_MS = 4000; // ignora el mismo QR mientras sigue frente a la cámara
const RESULTADO_MS = 2600; // tiempo que queda el resultado en pantalla antes de volver a escanear

/** Traduce los errores de getUserMedia a un mensaje accionable para el portero. */
function errorDeCamara(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        icono: LockKey,
        titulo: 'Permiso de cámara denegado',
        texto: 'Habilitá la cámara desde el candado de la barra de direcciones (o en Ajustes del sitio / de la app) y volvé a intentar. Mientras tanto podés cargar los códigos a mano.',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { icono: CameraSlash, titulo: 'No encontramos una cámara', texto: 'Este dispositivo no tiene cámara disponible. Cargá el código a mano o usá un lector de códigos.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { icono: CameraSlash, titulo: 'La cámara está en uso', texto: 'Otra app o pestaña está usando la cámara. Cerrala y volvé a intentar.' };
    case 'AbortError':
      return { icono: CameraSlash, titulo: 'La cámara no respondió', texto: 'Volvé a intentar. Si sigue igual, reiniciá el navegador.' };
    default:
      return { icono: CameraSlash, titulo: 'No se pudo abrir la cámara', texto: err?.message || 'Error desconocido.' };
  }
}

const vibrar = (patron) => { try { navigator.vibrate?.(patron); } catch { /* sin soporte */ } };

export default function PorteriaQRReader({ idEvento, onValidado }) {
  const reducir = useReducedMotion();
  const video = useRef(null);
  const canvas = useRef(null);
  const stream = useRef(null);
  const bucle = useRef(null);
  const ultimo = useRef({ codigo: '', hora: 0 });
  const ocupado = useRef(false); // hay una validación en curso
  const pausa = useRef(false); // pausa corta de la cámara después de cada lectura
  const idEventoRef = useRef(idEvento);
  idEventoRef.current = idEvento;
  const manual = useRef(null);

  const [camara, setCamara] = useState('inactiva'); // inactiva | solicitando | activa | error
  const [errorCam, setErrorCam] = useState(null);
  const [permiso, setPermiso] = useState(null); // granted | denied | prompt | null (sin Permissions API)
  const [camaras, setCamaras] = useState([]);
  const [idCamara, setIdCamara] = useState(null);
  const [linterna, setLinterna] = useState({ disponible: false, encendida: false });
  const [codigo, setCodigo] = useState('');
  const [resultado, setResultado] = useState(null); // { ...respuesta, codigo, n }
  const [errorRed, setErrorRed] = useState('');
  const [validando, setValidando] = useState(false);
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);

  // Estado del permiso (Chrome, Edge, Firefox; Safari puede no soportarlo): sirve para avisar antes del primer uso
  useEffect(() => {
    let estado;
    navigator.permissions?.query({ name: 'camera' })
      .then((s) => { estado = s; setPermiso(s.state); s.onchange = () => setPermiso(s.state); })
      .catch(() => {});
    return () => { if (estado) estado.onchange = null; };
  }, []);

  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const validar = useCallback(async (valor) => {
    const texto = String(valor || '').trim();
    if (!texto || ocupado.current) return;
    ocupado.current = true;
    pausa.current = true;
    setValidando(true);
    setErrorRed('');
    try {
      const r = await porteriaApi.validarQR(texto, idEventoRef.current || undefined);
      setEnLinea(true);
      setResultado((prev) => ({ ...r, codigo: texto, n: (prev?.n || 0) + 1 }));
      vibrar(r.valido ? 90 : [220, 90, 220]);
      onValidado?.(r);
    } catch (e) {
      // Un error de red NO es una entrada inválida: se informa aparte y no se registra nada
      // Sin respuesta del servidor = sin conexión (navigator.onLine no siempre es confiable)
      if (!e.response) setEnLinea(false);
      setErrorRed(e.response ? mensajeError(e) : 'Sin conexión con el servidor: la entrada no se validó. Revisá el wifi o los datos y volvé a escanear.');
      vibrar([60, 60, 60]);
      ultimo.current = { codigo: '', hora: 0 }; // permite reintentar el mismo QR enseguida
    } finally {
      ocupado.current = false;
      setValidando(false);
      setCodigo('');
      setTimeout(() => { pausa.current = false; }, 900);
    }
  }, [onValidado]);

  // El resultado se oculta solo para seguir escaneando sin tocar la pantalla
  useEffect(() => {
    if (!resultado) return;
    const t = setTimeout(() => setResultado(null), RESULTADO_MS);
    return () => clearTimeout(t);
  }, [resultado]);

  const detener = useCallback(() => {
    clearInterval(bucle.current);
    bucle.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setLinterna({ disponible: false, encendida: false });
    setCamara((c) => (c === 'error' ? c : 'inactiva'));
  }, []);

  const analizar = useCallback(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || v.readyState < 2 || !v.videoWidth || ocupado.current || pausa.current) return;
    const escala = Math.min(1, ANCHO_ANALISIS / v.videoWidth);
    const w = Math.round(v.videoWidth * escala);
    const h = Math.round(v.videoHeight * escala);
    if (c.width !== w) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, h);
    const qr = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (!qr?.data) return;
    const ahora = Date.now();
    if (qr.data === ultimo.current.codigo && ahora - ultimo.current.hora < MISMO_CODIGO_MS) return;
    ultimo.current = { codigo: qr.data, hora: ahora };
    validar(qr.data);
  }, [validar]);

  const iniciar = useCallback(async (deviceId = idCamara) => {
    setErrorCam(null);
    if (!window.isSecureContext) {
      setCamara('error');
      setErrorCam({ icono: LockKey, titulo: 'Se necesita HTTPS', texto: 'El navegador sólo permite usar la cámara en sitios seguros (https:// o localhost). Abrí la app desde su dirección https.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamara('error');
      setErrorCam({ icono: CameraSlash, titulo: 'Navegador sin acceso a cámara', texto: 'Actualizá el navegador o usá Chrome, Edge o Safari. Podés cargar los códigos a mano.' });
      return;
    }
    detener();
    setCamara('solicitando');
    try {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        // Algunas cámaras de escritorio rechazan las restricciones: se reintenta con { video: true }
        if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError') throw err;
        s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      stream.current = s;
      video.current.srcObject = s;
      await video.current.play();

      const pista = s.getVideoTracks()[0];
      setIdCamara(pista.getSettings?.().deviceId || null);
      setLinterna({ disponible: Boolean(pista.getCapabilities?.().torch), encendida: false });
      // Los nombres de las cámaras sólo están disponibles después de conceder el permiso
      const dispositivos = await navigator.mediaDevices.enumerateDevices();
      setCamaras(dispositivos.filter((d) => d.kind === 'videoinput'));

      setCamara('activa');
      bucle.current = setInterval(analizar, INTERVALO_MS);
    } catch (err) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      setCamara('error');
      setErrorCam(errorDeCamara(err));
      setTimeout(() => manual.current?.focus(), 50);
    }
  }, [analizar, detener, idCamara]);

  // Libera la cámara al salir de la pantalla y la pausa con la app en segundo plano (ahorra batería)
  const reanudar = useRef(false);
  useEffect(() => {
    const visibilidad = () => {
      if (document.hidden && stream.current) { reanudar.current = true; detener(); }
      else if (!document.hidden && reanudar.current) { reanudar.current = false; iniciar(); }
    };
    document.addEventListener('visibilitychange', visibilidad);
    return () => document.removeEventListener('visibilitychange', visibilidad);
  }, [detener, iniciar]);
  useEffect(() => () => detener(), [detener]);

  const cambiarCamara = () => {
    if (camaras.length < 2) return;
    const i = camaras.findIndex((c) => c.deviceId === idCamara);
    iniciar(camaras[(i + 1) % camaras.length].deviceId);
  };

  const alternarLinterna = async () => {
    const pista = stream.current?.getVideoTracks()[0];
    if (!pista) return;
    try {
      await pista.applyConstraints({ advanced: [{ torch: !linterna.encendida }] });
      setLinterna((l) => ({ ...l, encendida: !l.encendida }));
    } catch { setLinterna({ disponible: false, encendida: false }); }
  };

  const estilo = resultado && ESTILO_RESULTADO[resultado.estado];
  const negativo = resultado && !resultado.valido;
  const activa = camara === 'activa';

  return (
    <div className="space-y-4">
      {!enLinea && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-amber-100 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          <WifiSlash size={18} weight="bold" aria-hidden /> Sin conexión. Las entradas no se pueden validar hasta que vuelva internet.
        </p>
      )}

      {/* Visor: video + marco de escaneo + resultado superpuesto */}
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-zinc-950 ring-1 ring-zinc-900/10 sm:aspect-4/3 dark:ring-white/10">
        <video ref={video} muted playsInline aria-label="Vista de la cámara" className={`h-full w-full object-cover ${activa ? '' : 'invisible'}`} />
        <canvas ref={canvas} className="hidden" />

        {activa && !resultado && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
            <div className="relative h-[62%] aspect-square">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl', 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl'].map((c) => (
                <span key={c} className={`absolute h-10 w-10 border-white/90 ${c}`} />
              ))}
              {!reducir && (
                <motion.span
                  className="absolute inset-x-3 h-0.5 rounded-full bg-indigo-400 shadow-[0_0_16px_2px_rgb(129_140_248/0.8)]"
                  initial={{ top: '8%' }}
                  animate={{ top: ['8%', '92%', '8%'] }}
                  transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
                />
              )}
            </div>
            <p className="absolute bottom-4 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">
              {validando ? 'Validando…' : 'Apuntá al QR de la entrada'}
            </p>
          </div>
        )}

        {/* Estado sin cámara */}
        {!activa && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-zinc-300">
            {camara === 'error' && errorCam ? (
              <>
                <errorCam.icono size={44} weight="duotone" className="text-rose-400" aria-hidden />
                <p className="text-lg font-semibold text-white">{errorCam.titulo}</p>
                <p className="max-w-[40ch] text-sm text-zinc-300">{errorCam.texto}</p>
              </>
            ) : camara === 'solicitando' ? (
              <>
                <Camera size={44} weight="duotone" className="animate-pulse text-indigo-400" aria-hidden />
                <p className="font-medium text-white">Esperando permiso de cámara…</p>
                <p className="max-w-[36ch] text-sm">Tocá «Permitir» en el aviso del navegador.</p>
              </>
            ) : (
              <>
                <Camera size={44} weight="duotone" className="text-indigo-400" aria-hidden />
                <p className="font-medium text-white">Cámara apagada</p>
                <p className="max-w-[36ch] text-sm">
                  {permiso === 'denied'
                    ? 'El permiso de cámara está bloqueado para este sitio. Habilitalo desde el candado de la barra de direcciones.'
                    : permiso === 'granted'
                      ? 'Tocá «Escanear» para empezar.'
                      : 'La primera vez el navegador te va a pedir permiso para usar la cámara.'}
                </p>
              </>
            )}
          </div>
        )}

        {/* Resultado sobre el video: resorte si es válido, sacudida si no */}
        <div aria-live="assertive" aria-atomic="true">
          <AnimatePresence>
            {estilo && (
              <motion.div
                key={resultado.n}
                initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.94)' }}
                animate={
                  reducir
                    ? { opacity: 1 }
                    : negativo
                      ? { opacity: 1, transform: ['scale(1) translateX(0px)', 'scale(1) translateX(-12px)', 'scale(1) translateX(9px)', 'scale(1) translateX(-5px)', 'scale(1) translateX(0px)'] }
                      : { opacity: 1, transform: 'scale(1)' }
                }
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={reducir ? { duration: 0.15 } : negativo ? { duration: 0.42, ease: 'easeOut' } : { type: 'spring', duration: 0.45, bounce: 0.3 }}
                className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white ${estilo.caja}`}
                onClick={() => setResultado(null)}
              >
                <estilo.icono size={72} weight="fill" aria-hidden />
                <p className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{estilo.titulo}</p>
                {!resultado.permitido && resultado.motivo && (
                  <p className="mt-1 text-lg text-white/90">{resultado.motivo}</p>
                )}
                {resultado.ticket && (
                  <p className="mt-4 rounded-2xl bg-black/20 px-4 py-3">
                    <b className="text-lg">{resultado.ticket.titular}</b>
                    <span className="block text-sm text-white/85">
                      {resultado.ticket.nombre_tipo}{resultado.ticket.asiento && ` · ${resultado.ticket.asiento}`} · {resultado.ticket.evento}
                    </span>
                  </p>
                )}
                <p className="mt-4 max-w-full truncate font-mono text-xs text-white/75">Código leído: {resultado.codigo}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Controles sobre el video */}
        {activa && !resultado && (
          <div className="absolute right-3 top-3 flex gap-2">
            {linterna.disponible && (
              <button type="button" onClick={alternarLinterna} aria-pressed={linterna.encendida} aria-label={linterna.encendida ? 'Apagar linterna' : 'Encender linterna'}
                className={`grid h-11 w-11 place-items-center rounded-full backdrop-blur transition-[transform,background-color] duration-150 active:scale-[0.94] ${linterna.encendida ? 'bg-amber-300 text-zinc-950' : 'bg-black/55 text-white hover:bg-black/70'}`}>
                <Flashlight size={20} weight="bold" aria-hidden />
              </button>
            )}
            {camaras.length > 1 && (
              <button type="button" onClick={cambiarCamara} aria-label="Cambiar de cámara"
                className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-[transform,background-color] duration-150 hover:bg-black/70 active:scale-[0.94]">
                <CameraRotate size={20} weight="bold" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>

      {errorRed && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/20">
          <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden /> {errorRed}
        </p>
      )}

      <button
        type="button"
        className={`${activa ? 'btn-secondary' : 'btn-primary'} w-full py-3!`}
        onClick={activa ? detener : () => iniciar()}
        disabled={camara === 'solicitando'}
      >
        {activa
          ? <><StopCircle size={18} weight="bold" aria-hidden /> Detener cámara</>
          : <><Camera size={18} weight="bold" aria-hidden /> {camara === 'error' ? 'Reintentar cámara' : 'Escanear con cámara'}</>}
      </button>

      {/* Alternativa manual: también recibe lectores de código USB/Bluetooth (escriben el código + Enter) */}
      <form onSubmit={(e) => { e.preventDefault(); validar(codigo); }} className="space-y-1.5">
        <label className="label flex items-center gap-1.5" htmlFor="porteria-codigo-manual">
          <Keyboard size={16} weight="bold" aria-hidden /> Ingresar código manualmente
        </label>
        <div className="flex gap-2">
          <input
            id="porteria-codigo-manual"
            ref={manual}
            className="input font-mono"
            placeholder="Código impreso bajo el QR"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={64}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <button className="btn-secondary shrink-0" disabled={!codigo.trim() || validando}>{validando ? 'Validando…' : 'Validar'}</button>
        </div>
      </form>
    </div>
  );
}
