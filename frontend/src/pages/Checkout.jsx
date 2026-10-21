import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarBlank, Handshake, LockKey, MapPin, Minus, Plus, Storefront, Ticket, Wallet } from '@phosphor-icons/react';
import { mensajeError, pagosApi, urlUpload } from '../api/client';
import { Alerta, Skeleton, Vacio } from '../components/ui';
import WhatsappInput from '../components/WhatsappInput';
import { fecha, importe, moneda } from '../utils/format';

const EASE_OUT = [0.23, 1, 0.32, 1];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * /checkout/:linkId — página del complejo a la que lleva el link de pago de un vendedor.
 * Muestra el complejo (logo, nombre, dirección), el producto y un formulario para el comprador.
 * «Comprar» → POST /api/pagos/crear → init_point del MercadoPago DEL COMPLEJO → window.location.href.
 */
export default function Checkout() {
  const { linkId } = useParams();
  const [params] = useSearchParams();
  const reducir = useReducedMotion();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [errorCarga, setErrorCarga] = useState('');
  const [idEvento, setIdEvento] = useState(null);
  const [cantidades, setCantidades] = useState({});
  const [comprador, setComprador] = useState({ nombre: '', email: '', telefono: '' });
  const [telefonoOk, setTelefonoOk] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    pagosApi.checkout(linkId)
      .then((d) => {
        setDatos(d);
        if (d.eventos.length === 1) setIdEvento(d.eventos[0].id_evento);
        // Producto fijo (tipo + cantidad): ya viene elegido
        if (d.producto.id_tipo && d.producto.cantidad) setCantidades({ [d.producto.id_tipo]: d.producto.cantidad });
      })
      .catch((e) => setErrorCarga(mensajeError(e)));
  }, [linkId]);

  useEffect(() => {
    if (params.get('pago') === 'rechazado') setError('MercadoPago rechazó el pago. Podés intentar de nuevo con otro medio.');
  }, [params]);

  const evento = useMemo(() => datos?.eventos.find((e) => e.id_evento === idEvento), [datos, idEvento]);

  if (errorCarga) {
    return (
      <div className="mx-auto max-w-md py-12">
        <Vacio icono={Storefront} titulo="Link no disponible">{errorCarga}</Vacio>
      </div>
    );
  }
  if (!datos) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-6 lg:grid-cols-5"><Skeleton className="h-96 lg:col-span-3" /><Skeleton className="h-96 lg:col-span-2" /></div>
      </div>
    );
  }

  const { complejo, producto } = datos;
  const fijo = Boolean(producto.id_tipo && producto.cantidad);
  const items = Object.entries(cantidades).filter(([, n]) => n > 0).map(([id_tipo, cantidad]) => ({ id_tipo: Number(id_tipo), cantidad }));
  const totalCantidad = items.reduce((s, i) => s + i.cantidad, 0);
  const total = evento ? evento.tipos.reduce((s, t) => s + (cantidades[t.id_tipo] || 0) * t.precio, 0) : 0;
  const limite = evento?.limite_por_persona || null;
  const cantidadOk = producto.cantidad ? totalCantidad === producto.cantidad : totalCantidad > 0 && (!limite || totalCantidad <= limite);
  const datosOk = comprador.nombre.trim().length >= 2 && EMAIL_RE.test(comprador.email.trim()) && telefonoOk;
  const listo = datos.mercadopago_disponible && evento && cantidadOk && datosOk;

  const cambiar = (t, delta) => {
    const actual = cantidades[t.id_tipo] || 0;
    const tope = Math.min(t.stock_disponible, producto.cantidad || limite || 50);
    const otros = totalCantidad - actual;
    setCantidades({ ...cantidades, [t.id_tipo]: Math.max(0, Math.min(actual + delta, tope - otros)) });
  };

  const comprar = async (e) => {
    e.preventDefault();
    if (!listo) return;
    setEnviando(true);
    setError('');
    try {
      const r = await pagosApi.crear({
        link_id: datos.link_id, id_evento: evento.id_evento, items,
        comprador: { nombre: comprador.nombre.trim(), email: comprador.email.trim(), telefono: comprador.telefono },
      });
      window.location.href = r.url; // init_point del checkout de MercadoPago del complejo
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Identidad del complejo */}
      <header className="card flex flex-col gap-4 sm:flex-row sm:items-center" data-testid="complejo">
        {complejo.logo_url ? (
          <img src={complejo.logo_url} alt={`Logo de ${complejo.nombre}`} className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-zinc-900/10 dark:ring-white/10" />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-2xl font-semibold text-white" style={{ backgroundColor: complejo.color || '#4f46e5' }} aria-hidden>
            {complejo.nombre.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{complejo.nombre}</h1>
          {complejo.direccion && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"><MapPin size={16} weight="duotone" aria-hidden /> {complejo.direccion}</p>
          )}
        </div>
        <p className="flex items-center gap-2 self-start rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-800 sm:self-center dark:bg-indigo-500/10 dark:text-indigo-200">
          <Handshake size={18} weight="duotone" aria-hidden /> Te atiende <b>{datos.vendedor}</b>
        </p>
      </header>

      {!datos.mercadopago_disponible && (
        <Alerta tipo="info">{complejo.nombre} todavía no tiene habilitado el pago online. Consultá con {datos.vendedor}.</Alerta>
      )}

      {datos.eventos.length === 0 ? (
        <Vacio icono={Ticket} titulo="No hay entradas disponibles">Este link no tiene eventos a la venta en este momento.</Vacio>
      ) : (
        <form onSubmit={comprar} className="grid gap-6 lg:grid-cols-5" noValidate>
          <section className="min-w-0 space-y-5 lg:col-span-3">
            {datos.eventos.length > 1 && (
              <fieldset>
                <legend className="mb-2 text-lg font-semibold">Elegí el evento</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {datos.eventos.map((ev) => (
                    <label key={ev.id_evento} className={`flex cursor-pointer gap-3 rounded-2xl p-3 ring-1 transition-[box-shadow,background-color] duration-150 ${idEvento === ev.id_evento ? 'bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'ring-zinc-900/10 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5'}`}>
                      <input type="radio" name="evento" className="sr-only" checked={idEvento === ev.id_evento} onChange={() => { setIdEvento(ev.id_evento); setCantidades({}); }} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{ev.nombre}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{fecha(ev.fecha)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <AnimatePresence mode="wait">
              {evento && (
                <motion.div
                  key={evento.id_evento}
                  initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                  className="card space-y-4 overflow-hidden"
                >
                  {evento.imagen_evento && <img src={urlUpload(evento.imagen_evento)} alt="" className="-mx-5 -mt-5 mb-1 aspect-[21/9] w-[calc(100%+2.5rem)] max-w-none object-cover" />}
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">{evento.nombre}</h2>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                      <span className="flex items-center gap-1.5"><CalendarBlank size={16} weight="duotone" aria-hidden /> {fecha(evento.fecha)}</span>
                      {evento.lugar && <span className="flex items-center gap-1.5"><MapPin size={16} weight="duotone" aria-hidden /> {evento.lugar}</span>}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {evento.tipos.map((t) => {
                      const n = cantidades[t.id_tipo] || 0;
                      return (
                        <div key={t.id_tipo} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ${n ? 'bg-indigo-50/60 ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-500/30' : 'ring-zinc-900/5 dark:ring-white/5'}`}>
                          <span className="min-w-0">
                            <span className="block font-medium">{t.nombre_tipo} <span className="text-indigo-600 tabular-nums dark:text-indigo-400">{moneda(t.precio)}</span></span>
                            {t.condiciones && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t.condiciones}</span>}
                          </span>
                          {fijo ? (
                            <span className="text-sm font-medium tabular-nums">{n} entrada{n === 1 ? '' : 's'}</span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <button type="button" onClick={() => cambiar(t, -1)} disabled={!n} aria-label={`Quitar una entrada ${t.nombre_tipo}`}
                                className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-zinc-900/10 transition-transform duration-150 active:scale-[0.92] disabled:opacity-40 dark:ring-white/15"><Minus size={16} weight="bold" aria-hidden /></button>
                              <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">{n}</span>
                              <button type="button" onClick={() => cambiar(t, 1)} disabled={!t.stock_disponible} aria-label={`Agregar una entrada ${t.nombre_tipo}`}
                                className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-white transition-transform duration-150 active:scale-[0.92] disabled:opacity-40"><Plus size={16} weight="bold" aria-hidden /></button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {producto.cantidad && !fijo && <p className="text-xs text-zinc-500 dark:text-zinc-400">Este link es para {producto.cantidad} entrada{producto.cantidad === 1 ? '' : 's'}.</p>}
                  {limite && !producto.cantidad && <p className="text-xs text-zinc-500 dark:text-zinc-400">Hasta {limite} entradas por persona.</p>}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <aside className="min-w-0 lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
            <div className="card space-y-4 p-6" data-testid="formulario-comprador">
              <h2 className="text-lg font-semibold">Tus datos</h2>
              <Alerta onClose={() => setError('')}>{error}</Alerta>
              <div>
                <label className="label" htmlFor="ck-nombre">Nombre y apellido</label>
                <input id="ck-nombre" className="input" autoComplete="name" maxLength={80} value={comprador.nombre} onChange={(e) => setComprador({ ...comprador, nombre: e.target.value })} required />
              </div>
              <div>
                <label className="label" htmlFor="ck-email">Email</label>
                <input id="ck-email" className="input" type="email" autoComplete="email" inputMode="email" value={comprador.email} onChange={(e) => setComprador({ ...comprador, email: e.target.value })} required />
              </div>
              <WhatsappInput label="Teléfono (WhatsApp)" value={comprador.telefono} onChange={(telefono) => setComprador({ ...comprador, telefono })} onValidez={setTelefonoOk} />

              <div className="flex items-baseline justify-between border-t border-zinc-100 pt-4 dark:border-white/10">
                <span className="font-medium">Total</span>
                <motion.span key={total} initial={reducir ? false : { opacity: 0.4, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="text-2xl font-semibold tabular-nums tracking-tight">{totalCantidad ? moneda(total) : importe(0)}</motion.span>
              </div>
              <button className="btn-primary w-full py-3!" disabled={!listo || enviando}>
                <Wallet size={18} weight="bold" aria-hidden /> {enviando ? 'Abriendo MercadoPago…' : 'Comprar'}
              </button>
              <p className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <LockKey size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                Pagás en MercadoPago directamente a {complejo.nombre}. Las entradas con QR te llegan por WhatsApp.
              </p>
            </div>
          </aside>
        </form>
      )}
    </div>
  );
}
