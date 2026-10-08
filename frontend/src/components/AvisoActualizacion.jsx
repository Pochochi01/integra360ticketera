import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowsClockwise, X } from '@phosphor-icons/react';
import { actualizarPWA, descartarActualizacion, usePWA } from '../pwa';

/** Aviso cuando el Service Worker descargó una versión nueva de la app. Se actualiza al tocar, nunca solo. */
export default function AvisoActualizacion() {
  const { actualizacion } = usePWA();
  const reducir = useReducedMotion();
  return (
    <AnimatePresence>
      {actualizacion && (
        <motion.div
          role="status"
          initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(16px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)' }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-zinc-900 p-3 pl-4 text-sm text-white shadow-2xl ring-1 ring-white/10 dark:bg-zinc-800"
        >
          <span className="flex-1">Hay una versión nueva de la app.</span>
          <button type="button" className="btn bg-indigo-500 py-1.5! text-white hover:bg-indigo-400" onClick={actualizarPWA}>
            <ArrowsClockwise size={16} weight="bold" aria-hidden /> Actualizar
          </button>
          <button type="button" aria-label="Cerrar aviso" className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white" onClick={descartarActualizacion}>
            <X size={16} weight="bold" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
