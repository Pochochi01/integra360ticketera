import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import QRCode from 'qrcode';
import { CalendarBlank, MapPin } from '@phosphor-icons/react';
import { urlUpload } from '../../api/client';
import { fecha, moneda } from '../../utils/format';

const RESORTE = { stiffness: 140, damping: 18, mass: 0.6 };

/**
 * Entrada real del próximo evento, en 3D: se inclina siguiendo el puntero (springs fuera del ciclo de render)
 * y un brillo acompaña al cursor. El QR es real: abre la página del evento.
 */
export default function EntradaDestacada({ evento, cargando }) {
  const reducir = useReducedMotion();
  const [qr, setQr] = useState(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotY = useSpring(useTransform(px, [0, 1], [-14, 14]), RESORTE);
  const rotX = useSpring(useTransform(py, [0, 1], [10, -10]), RESORTE);
  const brilloX = useTransform(px, [0, 1], ['0%', '100%']);
  const brilloY = useTransform(py, [0, 1], ['0%', '100%']);
  const brillo = useMotionTemplate`radial-gradient(420px circle at ${brilloX} ${brilloY}, rgb(255 255 255 / 0.16), transparent 55%)`;

  const destino = evento ? `/eventos/${evento.id_evento}` : '/eventos';

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}${destino}`, { margin: 0, width: 220, color: { dark: '#18181b', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [destino]);

  const mover = (e) => {
    if (reducir || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const salir = () => {
    px.set(0.5);
    py.set(0.5);
  };

  if (cargando) {
    return <div className="aspect-5/7 w-full max-w-sm animate-pulse rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/5 dark:bg-white/5 dark:ring-white/10" aria-label="Cargando evento destacado" />;
  }

  return (
    <div className="w-full max-w-sm perspective-[1200px]" onPointerMove={mover} onPointerLeave={salir}>
      <motion.div
        style={reducir ? undefined : { rotateX: rotX, rotateY: rotY, transformStyle: 'preserve-3d' }}
        initial={reducir ? false : { opacity: 0, transform: 'translateY(32px) rotateX(18deg)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) rotateX(0deg)' }}
        transition={{ duration: 0.9, delay: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className="relative"
      >
        <Link
          to={destino}
          className="group relative block overflow-hidden rounded-3xl bg-zinc-900 ring-1 ring-white/10 shadow-[0_40px_120px_-30px_rgb(79_70_229/0.45)] dark:shadow-[0_40px_120px_-30px_rgb(79_70_229/0.55)] outline-offset-4 transition-transform duration-150 ease-out active:scale-[0.98]"
          aria-label={evento ? `Ver ${evento.nombre}` : 'Ver eventos'}
        >
          <div className="relative aspect-16/10 overflow-hidden">
            {evento?.imagen_evento ? (
              <img src={urlUpload(evento.imagen_evento)} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" />
            ) : (
              <img src="/landing/boliches.webp" alt="" className="h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-zinc-900 via-zinc-900/10 to-transparent" />
          </div>

          <div className="relative space-y-4 px-6 pb-6 pt-2">
            <div>
              {evento?.tenant && <p className="text-sm font-medium text-indigo-300">{evento.tenant}</p>}
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-zinc-50">{evento?.nombre || 'Tu próxima salida'}</h2>
            </div>
            {evento && (
              <div className="space-y-1.5 text-sm text-zinc-400">
                <p className="flex items-center gap-2"><CalendarBlank size={16} weight="bold" aria-hidden />{fecha(evento.fecha)}</p>
                <p className="flex items-center gap-2"><MapPin size={16} weight="bold" aria-hidden />{evento.lugar}</p>
              </div>
            )}

            {/* Troquel: línea punteada con muescas, como una entrada física */}
            <div className="relative -mx-6 my-1 border-t border-dashed border-white/15">
              <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-zinc-50 dark:bg-zinc-950" />
              <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-zinc-50 dark:bg-zinc-950" />
            </div>

            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs text-zinc-500">{evento ? 'Desde' : 'Entradas'}</p>
                <p className="text-xl font-semibold text-zinc-50">{evento?.precio_desde != null ? moneda(evento.precio_desde) : 'Con QR'}</p>
              </div>
              <div className="rounded-xl bg-white p-2 shadow-lg">
                {qr ? <img src={qr} alt="Código QR del evento" width="88" height="88" className="h-[88px] w-[88px]" /> : <div className="h-[88px] w-[88px]" />}
              </div>
            </div>
          </div>

          {!reducir && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl" style={{ background: brillo }} />}
        </Link>
      </motion.div>
    </div>
  );
}
