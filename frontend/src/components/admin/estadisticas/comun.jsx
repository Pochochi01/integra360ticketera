import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { mensajeError } from '../../../api/client';

/**
 * Piezas compartidas por los paneles analíticos del admin (estadísticas de ventas en /admin/ventas y control
 * de ingresos en /admin/porteros): consulta en vivo, indicador de actualización, tarjetas y estilo de gráficos.
 */
export const REFRESCO_MS = 10_000;

/**
 * Consulta en vivo: pide `obtener()` al montar, cada 10 s mientras la pestaña está visible y al volver a ella.
 * `clave` identifica qué se consulta (ej. el id del evento): al cambiar, se descartan datos y respuestas viejas.
 * Si `obtener` es null no consulta nada.
 */
export function useConsultaEnVivo(obtener, clave) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const pedido = useRef(0);
  const fn = useRef(obtener);
  fn.current = obtener;

  const actualizar = useCallback(async () => {
    if (!fn.current) return;
    const n = ++pedido.current;
    setCargando(true);
    try {
      const d = await fn.current();
      if (n === pedido.current) { setDatos(d); setError(''); } // descarta respuestas de una consulta anterior
    } catch (e) {
      if (n === pedido.current) setError(mensajeError(e));
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    setDatos(null);
    setError('');
    if (!fn.current) return undefined;
    actualizar();
    const id = setInterval(() => { if (document.visibilityState === 'visible') actualizar(); }, REFRESCO_MS);
    const alVolver = () => document.visibilityState === 'visible' && actualizar();
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
  }, [clave, actualizar]);

  return { datos, error, cargando, actualizar };
}

/** «hace 4 s»: se recalcula cada segundo para que se vea que los datos están vivos. Tocarlo actualiza ya. */
export function Actualizado({ en, cargando, onActualizar }) {
  const [, tic] = useState(0);
  useEffect(() => { const id = setInterval(() => tic((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  const seg = en ? Math.max(0, Math.round((Date.now() - new Date(en).getTime()) / 1000)) : null;
  return (
    <button type="button" onClick={onActualizar} className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-zinc-500 ring-1 ring-zinc-900/10 transition-colors hover:bg-zinc-50 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5"
      aria-label="Actualizar ahora" title={`Se actualiza solo cada ${REFRESCO_MS / 1000} s`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cargando ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden />
      <ArrowsClockwise size={12} weight="bold" className={cargando ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
      <span aria-live="polite">{seg === null ? 'Cargando…' : seg < 2 ? 'Actualizado ahora' : `Actualizado hace ${seg} s`}</span>
    </button>
  );
}

const TONOS = {
  indigo: 'text-indigo-600 dark:text-indigo-400', emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400', sky: 'text-sky-600 dark:text-sky-400', zinc: 'text-zinc-500 dark:text-zinc-400',
};

/** Tarjeta KPI de lectura rápida. */
export const Kpi = ({ icono: Icono, titulo, valor, detalle, tono = 'indigo', children }) => (
  <div className="min-w-0 rounded-2xl p-4 ring-1 ring-zinc-900/5 dark:ring-white/10">
    <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
      {Icono && <Icono size={16} weight="duotone" className={TONOS[tono]} aria-hidden />}
      {titulo}
    </p>
    <p className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>
    {detalle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{detalle}</p>}
    {children}
  </div>
);

/** Contenedor de un gráfico o bloque, con título y una acción opcional. */
export const Tarjeta = ({ titulo, children, accion }) => (
  <section className="min-w-0 rounded-2xl p-4 ring-1 ring-zinc-900/5 dark:ring-white/10">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">{titulo}</h4>
      {accion}
    </div>
    {children}
  </section>
);

/** Estilo común de Recharts: tooltip limpio y ejes recesivos que toman el color del texto. */
export const tooltipProps = {
  contentStyle: { borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgb(0 0 0 / 0.15)', fontSize: 12, color: '#18181b' },
  cursor: { fill: 'rgb(99 102 241 / 0.08)' },
};
export const ejes = { tick: { fontSize: 11, fill: 'currentColor' }, tickLine: false, axisLine: false };
export const compacto = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
