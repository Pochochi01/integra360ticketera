import { Link } from 'react-router-dom';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { ArrowsLeftRight, CalendarBlank, MapPin, Ticket } from '@phosphor-icons/react';
import { urlUpload } from '../../api/client';
import { Badge } from '../ui';
import { fecha } from '../../utils/format';

const RESORTE = { stiffness: 160, damping: 20, mass: 0.6 };

/**
 * Entrada "física" del comprador: imagen del evento, troquel con muescas y QR.
 * Inclinación 3D sutil siguiendo el puntero (sólo mouse, springs fuera del render, sin movimiento reducido).
 */
export default function TicketTarjeta({ t, onVerQr, onTransferir }) {
  const reducir = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotY = useSpring(useTransform(px, [0, 1], [-7, 7]), RESORTE);
  const rotX = useSpring(useTransform(py, [0, 1], [5, -5]), RESORTE);

  const mover = (e) => {
    if (reducir || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const salir = () => { px.set(0.5); py.set(0.5); };

  return (
    <div className="perspective-[1200px]" onPointerMove={mover} onPointerLeave={salir}>
      <motion.article
        style={reducir ? undefined : { rotateX: rotX, rotateY: rotY }}
        className="flex h-full flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-zinc-900/10 shadow-[0_20px_50px_-30px_rgb(79_70_229/0.45)] dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="relative h-28 overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          {t.imagen_evento ? (
            <img src={urlUpload(t.imagen_evento)} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center bg-linear-to-br from-indigo-600 to-indigo-900 text-indigo-200"><Ticket size={36} weight="duotone" aria-hidden /></div>
          )}
          <div className="absolute right-3 top-3"><Badge estado={t.estado} /></div>
        </div>

        <div className="flex flex-1 flex-col p-5">
          <h3 className="text-lg font-semibold leading-snug tracking-tight">{t.evento}</h3>
          <div className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <p className="flex items-center gap-2"><CalendarBlank size={15} weight="bold" aria-hidden />{fecha(t.fecha_evento)}</p>
            <p className="flex items-center gap-2"><MapPin size={15} weight="bold" aria-hidden /><span className="truncate">{t.lugar}</span></p>
          </div>
          <p className="mt-3 text-sm font-medium">{t.nombre_tipo}{t.asiento && <span className="text-indigo-600 dark:text-indigo-300"> · {t.asiento}</span>}</p>

          {/* Troquel: las muescas toman el color del fondo de la página */}
          <div className="relative -mx-5 my-4 border-t border-dashed border-zinc-300 dark:border-white/15">
            <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-zinc-50 dark:bg-zinc-950" />
            <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-zinc-50 dark:bg-zinc-950" />
          </div>

          {t.qr ? (
            <div className="mt-auto flex items-end justify-between gap-4">
              <button type="button" onClick={() => onVerQr(t)} className="rounded-xl bg-white p-2 ring-1 ring-zinc-900/10 transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-[0.97]" aria-label={`Ver entrada de ${t.evento} en grande`}>
                <img src={t.qr} alt="QR del ticket" className="h-24 w-24" />
              </button>
              {t.estado === 'valido' && (
                <button className="btn-secondary py-1.5!" onClick={() => onTransferir(t)}>
                  <ArrowsLeftRight size={16} weight="bold" aria-hidden /> Transferir
                </button>
              )}
            </div>
          ) : (
            <p className="mt-auto rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              Pendiente de pago. <Link className="font-medium underline" to={`/ventas/${t.id_venta}/pagar`}>Pagar</Link>
            </p>
          )}
        </div>
      </motion.article>
    </div>
  );
}
