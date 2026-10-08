import { motion, useReducedMotion } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1];

/** Entrada al hacer scroll (una sola vez). Con movimiento reducido el contenido aparece sin desplazamiento. */
export default function Aparecer({ as = 'div', retraso = 0, distancia = 24, className, children, ...resto }) {
  const reducir = useReducedMotion();
  const Componente = motion[as];
  return (
    <Componente
      initial={reducir ? { opacity: 0 } : { opacity: 0, transform: `translateY(${distancia}px)` }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: reducir ? 0.2 : 0.7, delay: reducir ? 0 : retraso, ease: EASE_OUT }}
      className={className}
      {...resto}
    >
      {children}
    </Componente>
  );
}
