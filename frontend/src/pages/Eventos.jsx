import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { MagnifyingGlass, Ticket, X } from '@phosphor-icons/react';
import { eventosApi, mensajeError } from '../api/client';
import { useTenant } from '../context/TenantContext';
import { Alerta, Skeleton, Vacio } from '../components/ui';
import TarjetaEvento from '../components/eventos/TarjetaEvento';

const EASE_OUT = [0.23, 1, 0.32, 1];
const FILTROS = [
  ['', 'Todos'],
  ['boliche', 'Boliches'],
  ['fiesta', 'Fiestas'],
  ['teatro', 'Teatros'],
  ['restaurante', 'Restaurantes'],
];

export default function Eventos() {
  const reducir = useReducedMotion();
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState('');
  // ?q= permite llegar con la búsqueda aplicada (ej. desde las categorías del inicio) y compartir la URL filtrada
  const [params, setParams] = useSearchParams();
  const busqueda = params.get('q') || '';
  const setBusqueda = (q) => setParams(q ? { q } : {}, { replace: true });
  const { tenant, tenantActual, setTenant } = useTenant();

  useEffect(() => {
    setEventos(null);
    setError('');
    eventosApi
      .listar()
      .then(setEventos)
      .catch((e) => {
        // Complejo guardado que ya no existe o fue suspendido: se vuelve a la vista general
        if (e.response?.status === 404 && tenant) return setTenant('');
        setError(mensajeError(e));
      });
  }, [tenant]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (eventos || [])
      .filter((e) => !q || `${e.nombre} ${e.lugar} ${e.tenant} ${e.descripcion || ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }, [eventos, busqueda]);

  return (
    <>
      <header className="mb-8 flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{tenantActual ? `Eventos de ${tenantActual.nombre}` : 'Eventos'}</h1>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">
            {eventos ? `${filtrados.length} ${filtrados.length === 1 ? 'evento' : 'eventos'}${busqueda ? ' para tu búsqueda' : ' próximos'}` : 'Buscando eventos…'}
          </p>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <LayoutGroup id="filtros-eventos">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:px-0" role="group" aria-label="Filtrar por tipo de salida">
              {FILTROS.map(([valor, etiqueta]) => {
                const activo = busqueda.toLowerCase() === valor;
                return (
                  <button
                    key={etiqueta}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => setBusqueda(valor)}
                    className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.96] ${
                      activo ? 'text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
                    }`}
                  >
                    {activo && (
                      <motion.span
                        layoutId="filtro-activo"
                        transition={reducir ? { duration: 0 } : { type: 'spring', duration: 0.35, bounce: 0.15 }}
                        className="absolute inset-0 rounded-full bg-indigo-600"
                      />
                    )}
                    {!activo && <span className="absolute inset-0 rounded-full ring-1 ring-zinc-900/10 dark:ring-white/15" />}
                    <span className="relative">{etiqueta}</span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>

          <label className="relative block lg:w-80">
            <span className="sr-only">Buscar eventos</span>
            <MagnifyingGlass size={16} weight="bold" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input className="input rounded-full! pl-10 pr-10" placeholder="Buscar por nombre, lugar o complejo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/10">
                <X size={14} weight="bold" aria-hidden />
              </button>
            )}
          </label>
        </div>
      </header>

      <Alerta>{error}</Alerta>

      {!eventos && !error && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Cargando eventos">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-3xl ring-1 ring-zinc-900/5 dark:ring-white/10">
              <Skeleton className="aspect-4/3 rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {eventos && filtrados.length === 0 && (
        <Vacio
          icono={Ticket}
          titulo={busqueda ? `No hay eventos para "${busqueda}"` : 'Todavía no hay eventos publicados'}
          accion={busqueda && <button type="button" className="btn-secondary mt-2" onClick={() => setBusqueda('')}>Ver todos los eventos</button>}
        >
          {busqueda ? 'Probá con otra palabra o elegí otro complejo arriba.' : 'Volvé pronto o elegí otro complejo desde el selector de arriba.'}
        </Vacio>
      )}

      {eventos && filtrados.length > 0 && (
        <motion.div layout={!reducir} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {filtrados.map((e, i) => (
              <motion.div
                key={e.id_evento}
                layout={!reducir}
                initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(16px) scale(0.98)' }}
                animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
                exit={{ opacity: 0, transform: 'scale(0.96)', transition: { duration: 0.15 } }}
                transition={{ duration: 0.45, delay: reducir ? 0 : Math.min(i, 8) * 0.04, ease: EASE_OUT }}
                className="flex"
              >
                <TarjetaEvento e={e} mostrarComplejo={!tenantActual} className="w-full" />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </>
  );
}
