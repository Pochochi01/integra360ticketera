import { motion, useReducedMotion } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1];

/** Pantalla dividida para ingreso y registro: formulario a la izquierda, foto de ambiente a la derecha (oculta en móvil). */
export default function AuthLayout({ titulo, subtitulo, imagen = '/landing/fiestas.webp', frase, children }) {
  const reducir = useReducedMotion();
  return (
    <div className="mx-auto grid min-h-[calc(100dvh-10rem)] max-w-5xl items-stretch overflow-hidden rounded-3xl bg-white ring-1 ring-zinc-900/5 lg:grid-cols-2 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex flex-col justify-center p-6 sm:p-10">
        <motion.div
          initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(12px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)' }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="mx-auto w-full max-w-sm"
        >
          <h1 className="text-3xl font-semibold tracking-tight">{titulo}</h1>
          {subtitulo && <p className="mt-2 text-zinc-500 dark:text-zinc-400">{subtitulo}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
      </div>
      <div className="relative hidden lg:block">
        <motion.img
          src={imagen}
          alt=""
          initial={reducir ? false : { transform: 'scale(1.08)' }}
          animate={{ transform: 'scale(1)' }}
          transition={{ duration: 1.4, ease: EASE_OUT }}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-t from-zinc-950/85 via-zinc-950/20 to-transparent" />
        {frase && <p className="absolute inset-x-0 bottom-0 p-10 text-2xl font-semibold leading-snug tracking-tight text-white">{frase}</p>}
      </div>
    </div>
  );
}
