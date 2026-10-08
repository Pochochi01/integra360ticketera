import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DownloadSimple, ScanSmiley, SignOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { porteriaApi } from '../api/client';
import { Vacio } from '../components/ui';
import PorteriaQRReader, { ESTILO_RESULTADO } from '../components/porteria/PorteriaQRReader';
import { fecha } from '../utils/format';
import { instalarPWA, usePWA } from '../pwa';

// El historial guarda el resultado con los nombres de la tabla accesos
const ESTADO_DE = { valido: 'ingresado', usado: 'ya_usado', invalido: 'invalido' };

/** /porteria — pantalla del portero: escanea entradas (pensada para usarse instalada como app en el celular). */
export default function Porteria() {
  const reducir = useReducedMotion();
  const { instalable, instalada } = usePWA();
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [eventos, setEventos] = useState([]);
  const [idEvento, setIdEvento] = useState('');
  const [historial, setHistorial] = useState([]);
  const [ingresos, setIngresos] = useState(0);

  const cargarHistorial = useCallback(() => porteriaApi.historial().then(setHistorial).catch(() => {}), []);
  useEffect(() => {
    porteriaApi.eventos().then(setEventos).catch(() => {});
    cargarHistorial();
  }, [cargarHistorial]);

  const alValidar = useCallback((r) => {
    if (r.valido) setIngresos((n) => n + 1);
    cargarHistorial();
  }, [cargarHistorial]);

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <section className="min-w-0 space-y-5 lg:col-span-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Portería</h1>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              {usuario?.nombre} · {usuario?.tenant}. Escaneá el QR de cada entrada: si es válida, queda marcada como ingresada.
            </p>
          </div>
          <div className="flex gap-2">
            {instalable && !instalada && (
              <button type="button" className="btn-secondary" onClick={instalarPWA}>
                <DownloadSimple size={16} weight="bold" aria-hidden /> Instalar app
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => { logout(); navigate('/login'); }}>
              <SignOut size={16} weight="bold" aria-hidden /> Cerrar sesión
            </button>
          </div>
        </div>

        <div className="card space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className="label" htmlFor="porteria-evento">Evento a controlar</label>
              <select id="porteria-evento" className="input" value={idEvento} onChange={(e) => setIdEvento(e.target.value)}>
                <option value="">Cualquier evento del complejo</option>
                {eventos.map((e) => <option key={e.id_evento} value={e.id_evento}>{e.nombre} · {fecha(e.fecha)}</option>)}
              </select>
            </div>
            <p className="rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
              Ingresos en este turno: <b className="tabular-nums text-zinc-900 dark:text-white">{ingresos}</b>
            </p>
          </div>
          <PorteriaQRReader idEvento={idEvento} onValidado={alValidar} />
        </div>
      </section>

      <section className="min-w-0 lg:col-span-2">
        <h2 className="mb-4 text-lg font-semibold">Últimas lecturas</h2>
        {historial.length === 0 ? (
          <Vacio icono={ScanSmiley} titulo="Todavía no hay lecturas">Cada código escaneado aparece acá con su resultado.</Vacio>
        ) : (
          <ul className="card divide-y divide-zinc-100 p-0! dark:divide-white/5">
            <AnimatePresence initial={false}>
              {historial.slice(0, 30).map((h) => {
                const e = ESTILO_RESULTADO[ESTADO_DE[h.resultado]];
                return (
                  <motion.li
                    key={h.id_acceso}
                    layout={!reducir}
                    initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-8px)' }}
                    animate={{ opacity: 1, transform: 'translateY(0px)' }}
                    transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.punto}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{h.evento || <span className="font-mono text-xs">{h.codigo_leido}</span>}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">{e.titulo} · {e.detalle}{h.validador && ` · ${h.validador}`}</span>
                    </span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{fecha(h.fecha)}</span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
}
