import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import { COLORES_ESTADO } from '../utils/format';

const EASE_OUT = [0.23, 1, 0.32, 1];

/** estado define el color; texto (opcional) reemplaza la etiqueta visible. */
export const Badge = ({ estado, texto }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
      COLORES_ESTADO[estado] || 'bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300'
    }`}
  >
    {texto || estado}
  </span>
);

const ESTILOS_ALERTA = {
  error: { clase: 'bg-rose-50 text-rose-800 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-400/20', icono: WarningCircle },
  exito: { clase: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/20', icono: CheckCircle },
  info: { clase: 'bg-sky-50 text-sky-800 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-400/20', icono: Info },
};

/** Aviso en línea. Entra con un leve desplazamiento (los avisos son ocasionales: la animación ayuda a notarlos). */
export const Alerta = ({ tipo = 'error', children, onClose }) => {
  const reducir = useReducedMotion();
  if (!children) return null;
  const { clase, icono: Icono } = ESTILOS_ALERTA[tipo];
  return (
    <motion.div
      role={tipo === 'error' ? 'alert' : 'status'}
      initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      className={`mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1 ${clase}`}
    >
      <Icono size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
      <span className="flex-1">{children}</span>
      {onClose && (
        <button onClick={onClose} className="-m-1 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100" aria-label="Cerrar aviso">
          <X size={14} weight="bold" aria-hidden />
        </button>
      )}
    </motion.div>
  );
};

/** Bloque de carga con brillo (reemplaza al spinner circular). */
export const Skeleton = ({ className = '' }) => (
  <div className={`relative overflow-hidden rounded-xl bg-zinc-200/70 dark:bg-white/5 ${className}`} aria-hidden>
    <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/50 to-transparent motion-safe:animate-[brillo_1.4s_ease-in-out_infinite] dark:via-white/5" />
  </div>
);

/** Estado de carga genérico de una pantalla: título + bloques con la forma típica del contenido. */
export const Spinner = () => (
  <div className="space-y-4 py-4" role="status" aria-label="Cargando">
    <Skeleton className="h-8 w-56" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
      <Skeleton className="hidden h-40 lg:block" />
    </div>
    <Skeleton className="h-24" />
  </div>
);

/**
 * Diálogo modal: entra con escala 0.96 + opacidad (centrado, no anclado a un disparador), cierra con Esc
 * o clic afuera, bloquea el scroll del fondo y devuelve el foco al cerrar.
 */
export const Modal = ({ titulo, children, onClose, ancho = 'max-w-md' }) => {
  const reducir = useReducedMotion();
  const idTitulo = useId();
  const panel = useRef(null);

  useEffect(() => {
    const previo = document.activeElement;
    const alTeclear = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', alTeclear);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('input, select, textarea, button:not([aria-label="Cerrar"])')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = overflow;
      previo?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <motion.div
        className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={onClose}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(12px) scale(0.96)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        transition={{ duration: 0.24, ease: EASE_OUT }}
        className={`relative max-h-[92dvh] w-full ${ancho} overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/10 sm:rounded-3xl dark:bg-zinc-900 dark:ring-white/10`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 id={idTitulo} className="text-lg font-semibold tracking-tight">{titulo}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Cerrar"
          >
            <X size={16} weight="bold" aria-hidden />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
};

/** Pestañas con indicador que se desliza entre opciones (layoutId). */
export const Tabs = ({ tabs, activa, onChange }) => {
  const id = useId();
  const reducir = useReducedMotion();
  return (
    <LayoutGroup id={id}>
      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 scrollbar-none dark:border-white/10">
        {tabs.map(([valor, label]) => {
          const seleccionada = activa === valor;
          return (
            <button
              key={valor}
              role="tab"
              aria-selected={seleccionada}
              onClick={() => onChange(valor)}
              className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
                seleccionada ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {label}
              {seleccionada && (
                <motion.span
                  layoutId="indicador"
                  transition={reducir ? { duration: 0 } : { type: 'spring', duration: 0.35, bounce: 0.15 }}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400"
                />
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
};

/** Estado vacío compuesto: ícono, mensaje y (opcional) acción. */
export const Vacio = ({ icono: Icono, titulo, children, accion }) => (
  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-white/15">
    {Icono && <Icono size={36} weight="duotone" className="text-indigo-500 dark:text-indigo-400" aria-hidden />}
    <p className="font-medium text-zinc-800 dark:text-zinc-200">{titulo}</p>
    {children && <p className="max-w-[44ch] text-sm text-zinc-500 dark:text-zinc-400">{children}</p>}
    {accion}
  </div>
);

// ---------------------------------------------------------------- Confirmación (reemplaza window.confirm)

const ConfirmarContext = createContext(null);

/**
 * Proveedor del diálogo de confirmación. Uso: const confirmar = useConfirmar();
 * if (await confirmar('¿Cancelar la compra?', { peligro: true, aceptar: 'Cancelar compra' })) …
 */
export function ConfirmarProvider({ children }) {
  const [pedido, setPedido] = useState(null);
  const confirmar = useCallback(
    (mensaje, opciones = {}) => new Promise((resolver) => setPedido({ mensaje, ...opciones, resolver })),
    []
  );
  const responder = (valor) => {
    pedido?.resolver(valor);
    setPedido(null);
  };
  return (
    <ConfirmarContext.Provider value={confirmar}>
      {children}
      <AnimatePresence>
        {pedido && (
          <Modal key="confirmar" titulo={pedido.titulo || 'Confirmar'} onClose={() => responder(false)} ancho="max-w-sm">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{pedido.mensaje}</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => responder(false)}>{pedido.cancelar || 'Volver'}</button>
              <button type="button" className={pedido.peligro ? 'btn-danger' : 'btn-primary'} onClick={() => responder(true)}>
                {pedido.aceptar || 'Confirmar'}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </ConfirmarContext.Provider>
  );
}

export const useConfirmar = () => useContext(ConfirmarContext);
