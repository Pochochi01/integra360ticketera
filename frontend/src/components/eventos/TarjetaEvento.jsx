import { Link } from 'react-router-dom';
import { CalendarBlank, MapPin, Ticket } from '@phosphor-icons/react';
import { urlUpload } from '../../api/client';
import { fecha, moneda } from '../../utils/format';

/**
 * Tarjeta de evento (inicio y listado). Se eleva al pasar el mouse y la imagen hace un zoom leve;
 * el precio queda siempre al pie para que las tarjetas de una fila queden alineadas.
 */
export default function TarjetaEvento({ e, mostrarComplejo = true, className = '' }) {
  return (
    <Link
      to={`/eventos/${e.id_evento}`}
      className={`group flex flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-zinc-900/10 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_24px_60px_-24px_rgb(79_70_229/0.5)] active:scale-[0.98] dark:bg-zinc-900 dark:ring-white/10 ${className}`}
    >
      <div className="relative aspect-4/3 overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {e.imagen_evento ? (
          <img src={urlUpload(e.imagen_evento)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" />
        ) : (
          <div className="grid h-full place-items-center text-zinc-400 dark:text-zinc-600"><Ticket size={48} weight="duotone" aria-hidden /></div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          {mostrarComplejo && <p className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{e.tenant}</p>}
          <h3 className="mt-1 line-clamp-2 text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50">{e.nombre}</h3>
        </div>
        <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <p className="flex items-center gap-2"><CalendarBlank size={15} weight="bold" aria-hidden />{fecha(e.fecha)}</p>
          <p className="flex items-center gap-2"><MapPin size={15} weight="bold" aria-hidden /><span className="truncate">{e.lugar}</span></p>
        </div>
        <p className="mt-auto flex items-center justify-between pt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {e.estado === 'agotado' ? (
            <span className="font-medium text-rose-600 dark:text-rose-300">Agotado</span>
          ) : e.precio_desde != null ? (
            <span>Desde <b className="tabular-nums text-zinc-900 dark:text-zinc-50">{moneda(e.precio_desde)}</b></span>
          ) : (
            <span>Próximamente</span>
          )}
          {e.limite_por_persona && <span className="text-xs text-zinc-500 dark:text-zinc-500">Máx. {e.limite_por_persona} por persona</span>}
        </p>
      </div>
    </Link>
  );
}
