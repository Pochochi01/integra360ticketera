import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight, CalendarBlank, CaretLeft, CaretRight, CreditCard, LinkSimple, MapPin, QrCode, ScanSmiley, Ticket, UsersThree, WhatsappLogo,
} from '@phosphor-icons/react';
import { eventosApi, mensajeError, urlUpload } from '../api/client';
import { useTenant } from '../context/TenantContext';
import { useTema } from '../context/TemaContext';
import EntradaDestacada from '../components/landing/EntradaDestacada';
import TarjetaEvento from '../components/eventos/TarjetaEvento';
import Aparecer from '../components/landing/Aparecer';
import { fecha, moneda } from '../utils/format';

// El fondo 3D (three.js) se carga aparte para no frenar la primera pintura del hero
const EscenaEntradas = lazy(() => import('../components/landing/EscenaEntradas'));

const EASE_OUT = [0.23, 1, 0.32, 1];

const CATEGORIAS = [
  { nombre: 'Boliches', texto: 'Noches largas, DJs y pista llena.', busqueda: 'boliche', img: '/landing/boliches.webp', clase: 'sm:col-span-2 lg:col-span-6 lg:row-span-2 min-h-[22rem] lg:min-h-0' },
  { nombre: 'Fiestas', texto: 'Temáticas, privadas y de fin de año.', busqueda: 'fiesta', img: '/landing/fiestas.webp', clase: 'lg:col-span-6 min-h-[15rem]' },
  { nombre: 'Teatros', texto: 'Butaca numerada, elegida en el plano.', busqueda: 'teatro', img: '/landing/teatros.webp', clase: 'lg:col-span-3 min-h-[15rem] lg:min-h-0' },
  { nombre: 'Restaurantes', texto: 'Cenas show y noches especiales.', busqueda: 'restaurante', img: '/landing/restaurantes.webp', clase: 'lg:col-span-3 min-h-[15rem] lg:min-h-0' },
];

const PASOS = [
  { icono: Ticket, titulo: 'Elegí tu entrada', texto: 'General, VIP o tu butaca en el plano. Ves el precio final antes de pagar.' },
  { icono: CreditCard, titulo: 'Pagá con MercadoPago', texto: 'Tarjeta, débito o dinero en cuenta. El pago va directo al organizador.' },
  { icono: WhatsappLogo, titulo: 'Recibila por WhatsApp', texto: 'Te llega el link con tus entradas. Sin imprimir, sin descargar apps.' },
  { icono: ScanSmiley, titulo: 'Entrá con el QR', texto: 'En la puerta lo escanean y listo. Cada código vale una sola vez.' },
];

const ORGANIZADORES = [
  { icono: CreditCard, titulo: 'Cobrás en tu MercadoPago', texto: 'Cada complejo conecta su propia cuenta.' },
  { icono: LinkSimple, titulo: 'Vendedores con link propio', texto: 'Cada venta queda registrada a quien la trajo.' },
  { icono: QrCode, titulo: 'Control de acceso con QR', texto: 'Validás desde el celular, sin entradas duplicadas.' },
  { icono: UsersThree, titulo: 'Invitaciones y corporativos', texto: 'Emití bloques de entradas o cortesías en segundos.' },
];

const esFuturo = (e) => new Date(String(e.fecha).replace(' ', 'T')) > new Date();

// ---------------------------------------------------------------- Hero

function Hero({ destacado, cargando, tema }) {
  const reducir = useReducedMotion();
  const entrada = (i) => ({
    initial: reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(28px)', filter: 'blur(8px)' },
    animate: { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
    transition: { duration: 0.8, delay: reducir ? 0 : 0.08 * i, ease: EASE_OUT },
  });

  return (
    <section className="relative isolate overflow-hidden">
      {/* Respaldo sin WebGL / mientras carga la escena: luz de escenario en CSS */}
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_70%_60%_at_75%_10%,rgb(79_70_229/0.35),transparent_60%),radial-gradient(ellipse_50%_50%_at_90%_80%,rgb(99_102_241/0.18),transparent_70%)]" />
      <Suspense fallback={null}>
        <EscenaEntradas key={tema} tema={tema} className="absolute inset-0 -z-10" />
      </Suspense>
      {/* Velo para que el texto siempre tenga contraste sobre la escena */}
      {/* En móvil el texto ocupa todo el ancho: velo parejo. En escritorio, degradé que deja ver la escena a la derecha */}
      <div className="absolute inset-0 -z-10 bg-zinc-50/80 lg:bg-transparent lg:bg-linear-to-r lg:from-zinc-50 lg:via-zinc-50/70 lg:to-zinc-50/0 dark:bg-zinc-950/75 dark:lg:bg-transparent dark:lg:from-zinc-950 dark:lg:via-zinc-950/60 dark:lg:to-zinc-950/10" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-t from-zinc-50 to-transparent dark:from-zinc-950" />

      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl items-center gap-14 px-4 pb-20 pt-14 lg:grid-cols-12 lg:pt-20">
        <div className="lg:col-span-7">
          <motion.h1 {...entrada(0)} className="max-w-[14ch] text-[2.5rem] font-semibold min-[400px]:text-5xl leading-[1.02] tracking-tighter text-zinc-900 dark:text-zinc-50 md:text-6xl lg:text-7xl">
            Tu noche empieza en un <span className="text-indigo-600 dark:text-indigo-400">QR</span>.
          </motion.h1>
          <motion.p {...entrada(1)} className="mt-6 max-w-[46ch] text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            Entradas para fiestas, boliches, teatros y restaurantes. Pagás con MercadoPago y la entrada te llega por WhatsApp.
          </motion.p>
          <motion.div {...entrada(2)} className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              to="/eventos"
              className="group inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_40px_-10px_rgb(79_70_229/0.8)] transition-[transform,background-color] duration-150 ease-out hover:bg-indigo-500 active:scale-[0.97]"
            >
              Ver eventos
              <ArrowRight size={16} weight="bold" className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a
              href="#organizadores"
              className="inline-flex items-center rounded-full bg-white/70 px-6 py-3 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-900/10 backdrop-blur transition-[transform,background-color] duration-150 ease-out hover:bg-white dark:bg-white/5 dark:text-zinc-100 dark:ring-white/15 dark:hover:bg-white/10 active:scale-[0.97]"
            >
              Soy organizador
            </a>
          </motion.div>
        </div>
        <div className="flex justify-center lg:col-span-5 lg:justify-end">
          <EntradaDestacada evento={destacado} cargando={cargando} />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Categorías (bento)

function Categorias() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <Aparecer as="h2" className="max-w-[18ch] text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-4xl">
        ¿Qué plan tenés para hoy?
      </Aparecer>
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:grid-rows-[16rem_16rem]">
        {CATEGORIAS.map((c, i) => (
          <Aparecer key={c.nombre} retraso={i * 0.06} className={`${c.clase} perspective-[1400px]`}>
            <Link
              to={`/eventos?q=${encodeURIComponent(c.busqueda)}`}
              className="categoria group relative flex h-full overflow-hidden rounded-3xl ring-1 ring-white/10 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]"
            >
              <img src={c.img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.06]" />
              <div className="absolute inset-0 bg-linear-to-t from-zinc-950/90 via-zinc-950/30 to-transparent" />
              <div className="relative mt-auto flex w-full items-end justify-between gap-4 p-6">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">{c.nombre}</h3>
                  <p className="mt-1 text-sm text-zinc-300">{c.texto}</p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition-[transform,background-color] duration-300 ease-out group-hover:bg-indigo-600" aria-hidden>
                  <ArrowRight size={18} weight="bold" />
                </span>
              </div>
            </Link>
          </Aparecer>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Próximos eventos (carrusel)

function ProximosEventos({ eventos, cargando, error }) {
  const pista = useRef(null);
  // Las flechas sólo aparecen si hay más eventos de los que entran en pantalla
  const [desborda, setDesborda] = useState(false);
  useEffect(() => {
    const el = pista.current;
    if (!el) return undefined;
    const medir = () => setDesborda(el.scrollWidth > el.clientWidth + 4);
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    medir();
    return () => ro.disconnect();
  }, [eventos.length, cargando]);
  const desplazar = (dir) => {
    const el = pista.current;
    if (!el) return;
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: reducir ? 'auto' : 'smooth' });
  };

  return (
    <section className="py-24" aria-labelledby="titulo-proximos">
      <div className="mx-auto flex max-w-6xl items-end justify-between gap-6 px-4">
        <Aparecer as="h2" id="titulo-proximos" className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-4xl">
          Próximos eventos
        </Aparecer>
        <div className="flex items-center gap-2">
          <Link to="/eventos" className="mr-2 hidden text-sm font-medium text-zinc-700 hover:text-zinc-950 sm:inline dark:text-zinc-300 dark:hover:text-white">Ver todos</Link>
          {desborda && [[-1, CaretLeft, 'Anteriores'], [1, CaretRight, 'Siguientes']].map(([dir, Icono, etiqueta]) => (
            <button
              key={etiqueta}
              type="button"
              onClick={() => desplazar(dir)}
              aria-label={`Eventos ${etiqueta.toLowerCase()}`}
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-zinc-700 ring-1 ring-zinc-900/10 transition-[transform,background-color] duration-150 ease-out hover:bg-zinc-100 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10 active:scale-[0.94]"
            >
              <Icono size={18} weight="bold" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div
        ref={pista}
        className="mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-4 px-4 pb-4 scrollbar-none lg:scroll-px-[max(1rem,calc((100vw-72rem)/2+1rem))] lg:px-[max(1rem,calc((100vw-72rem)/2+1rem))]"
      >
        {cargando &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[24rem] w-[17rem] shrink-0 animate-pulse rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/5 dark:bg-white/5 dark:ring-white/10 sm:w-[19rem]" />
          ))}
        {!cargando && error && <p className="text-sm text-rose-600 dark:text-rose-300">No pudimos cargar los eventos: {error}</p>}
        {!cargando && !error && eventos.length === 0 && (
          <div className="flex w-full max-w-md flex-col items-start gap-3 rounded-3xl bg-white p-8 ring-1 ring-zinc-900/10 dark:bg-white/5 dark:ring-white/10">
            <Ticket size={32} weight="duotone" className="text-indigo-600 dark:text-indigo-300" aria-hidden />
            <p className="text-zinc-800 dark:text-zinc-200">Todavía no hay eventos publicados acá.</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Probá con otro complejo desde el selector de arriba.</p>
          </div>
        )}
        {!cargando && eventos.map((e) => <TarjetaEvento key={e.id_evento} e={e} className="w-[17rem] shrink-0 snap-start sm:w-[19rem]" />)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Cómo funciona

function ComoFunciona() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-4 py-24 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-28">
          <Aparecer as="h2" className="max-w-[16ch] text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-5xl">
            Del pago a la puerta, sin filas.
          </Aparecer>
          <Aparecer as="p" retraso={0.08} className="mt-5 max-w-[40ch] text-zinc-600 dark:text-zinc-400">
            Comprás desde el celular y entrás con el código que te llegó. Nada más.
          </Aparecer>
        </div>
      </div>
      <ol className="relative space-y-4 lg:col-span-7">
        {PASOS.map(({ icono: Icono, titulo, texto }, i) => (
          <Aparecer as="li" key={titulo} retraso={i * 0.07} className="flex gap-5 rounded-3xl bg-white p-6 ring-1 ring-zinc-900/5 dark:bg-white/3 dark:ring-white/10">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600/10 text-indigo-600 ring-1 ring-indigo-600/20 dark:bg-indigo-600/15 dark:text-indigo-300 dark:ring-indigo-400/25">
              <Icono size={24} weight="duotone" aria-hidden />
            </span>
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h3>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{texto}</p>
            </div>
          </Aparecer>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- Organizadores

function Organizadores() {
  return (
    <section id="organizadores" className="scroll-mt-20 px-4 py-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] ring-1 ring-zinc-900/10 dark:ring-white/10">
        <img src="/landing/teatros.webp" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-15 dark:opacity-30" />
        <div className="absolute inset-0 bg-linear-to-br from-white via-white/90 to-indigo-100/80 dark:from-zinc-950 dark:via-zinc-950/90 dark:to-indigo-950/80" />
        <div className="relative grid gap-12 p-8 md:p-14 lg:grid-cols-2">
          <div>
            <Aparecer as="p" className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">Para organizadores</Aparecer>
            <Aparecer as="h2" retraso={0.05} className="mt-4 max-w-[16ch] text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-5xl">
              Vendé con tu marca y tu cuenta.
            </Aparecer>
            <Aparecer as="p" retraso={0.1} className="mt-5 max-w-[42ch] text-zinc-700 dark:text-zinc-300">
              Para boliches, teatros, productoras y restaurantes. Cada complejo administra sus eventos, vendedores y cobros.
            </Aparecer>
            <Aparecer retraso={0.15} className="mt-8">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 active:scale-[0.97]"
              >
                Acceder al panel <ArrowRight size={16} weight="bold" aria-hidden />
              </Link>
            </Aparecer>
          </div>
          <ul className="grid content-center gap-x-8 gap-y-8 sm:grid-cols-2">
            {ORGANIZADORES.map(({ icono: Icono, titulo, texto }, i) => (
              <Aparecer as="li" key={titulo} retraso={0.1 + i * 0.06}>
                <Icono size={28} weight="duotone" className="text-indigo-600 dark:text-indigo-300" aria-hidden />
                <h3 className="mt-3 font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{texto}</p>
              </Aparecer>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Página

export default function Inicio() {
  const { tenant } = useTenant();
  const { tema } = useTema();
  const [eventos, setEventos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError('');
    eventosApi
      .listar()
      .then((lista) => vigente && setEventos(lista))
      .catch((e) => vigente && setError(mensajeError(e)))
      .finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, [tenant]);

  const proximos = useMemo(
    () => eventos.filter(esFuturo).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).slice(0, 8),
    [eventos]
  );
  const destacado = proximos.find((e) => e.estado === 'publicado') || proximos[0] || null;

  return (
    <div className="font-display bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      <Hero destacado={destacado} cargando={cargando} tema={tema} />
      <Categorias />
      <ProximosEventos eventos={proximos} cargando={cargando} error={error} />
      <ComoFunciona />
      <Organizadores />
      <footer className="border-t border-zinc-900/10 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-semibold text-zinc-800 dark:text-zinc-300"><Ticket size={20} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden /> Integra360</p>
          <nav className="flex gap-6" aria-label="Pie de página">
            <Link to="/eventos" className="hover:text-zinc-900 dark:hover:text-zinc-200">Eventos</Link>
            <Link to="/registro" className="hover:text-zinc-900 dark:hover:text-zinc-200">Crear cuenta</Link>
            <Link to="/login" className="hover:text-zinc-900 dark:hover:text-zinc-200">Ingresar</Link>
          </nav>
          <p>© {new Date().getFullYear()} Integra360</p>
        </div>
      </footer>
    </div>
  );
}
