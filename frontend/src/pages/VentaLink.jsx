import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarBlank, LockKey, MapPin, Minus, Plus, Storefront, Wallet } from '@phosphor-icons/react';
import { mensajeError, salesLinksApi, urlUpload } from '../api/client';
import { Alerta, Skeleton, Vacio } from '../components/ui';
import WhatsappInput from '../components/WhatsappInput';
import { fecha, moneda } from '../utils/format';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_DISPONIBLE = {
  pausado: 'El complejo pausó este link de venta.',
  agotado: 'Se agotaron las entradas de este link.',
  usado: 'Este link ya fue utilizado.',
  evento_agotado: 'Se agotaron las entradas del evento.',
  evento_reservado: 'Las entradas están reservadas por otras compras en curso. Probá de nuevo en unos minutos.',
  evento_pasado: 'El evento ya ocurrió.',
  evento_no_publicado: 'El evento no está a la venta en este momento.',
  tipo_inactivo: 'Este tipo de entrada no está a la venta en este momento.',
};

/**
 * /venta/:linkId — link de venta del complejo, compartible en redes.
 * Muestra el complejo y el producto; el comprador completa nombre, email y teléfono.
 * «Comprar» → POST /api/ventas/checkout → init_point del MercadoPago DEL COMPLEJO → window.location.href.
 */
export default function VentaLink() {
  const { linkId } = useParams();
  const [params] = useSearchParams();
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [error, setError] = useState(params.get('pago') === 'rechazado' ? 'MercadoPago rechazó el pago. Podés intentar de nuevo con otro medio.' : '');
  const [cantidad, setCantidad] = useState(1);
  const [comprador, setComprador] = useState({ nombre: '', email: '', telefono: '' });
  const [telefonoOk, setTelefonoOk] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    salesLinksApi.publico(linkId)
      .then((d) => { setDatos(d); if (d.cantidad_fija) setCantidad(d.cantidad_fija); })
      .catch((e) => setErrorCarga(mensajeError(e)));
  }, [linkId]);

  if (errorCarga) {
    return <div className="mx-auto max-w-md py-12"><Vacio icono={Storefront} titulo="Link no disponible">{errorCarga}</Vacio></div>;
  }
  if (!datos) {
    return <div className="mx-auto max-w-3xl space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  const { complejo, evento } = datos;
  const datosOk = comprador.nombre.trim().length >= 2 && EMAIL_RE.test(comprador.email.trim()) && telefonoOk;
  const listo = datos.disponible && datos.mercadopago_disponible && datosOk && cantidad >= 1;

  const comprar = async (e) => {
    e.preventDefault();
    if (!listo) return;
    setEnviando(true);
    setError('');
    try {
      const r = await salesLinksApi.checkout({
        linkId: datos.link_id, cantidad,
        comprador: { nombre: comprador.nombre.trim(), email: comprador.email.trim(), telefono: comprador.telefono },
      });
      window.location.href = r.init_point; // checkout de MercadoPago del complejo
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="card flex items-center gap-4">
        {complejo.logo_url ? (
          <img src={complejo.logo_url} alt={`Logo de ${complejo.nombre}`} className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-zinc-900/10 dark:ring-white/10" />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-2xl font-semibold text-white" style={{ backgroundColor: complejo.color || '#4f46e5' }} aria-hidden>{complejo.nombre.slice(0, 1)}</span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{complejo.nombre}</h1>
          {complejo.direccion && <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"><MapPin size={16} weight="duotone" aria-hidden /> {complejo.direccion}</p>}
          {datos.vendedor && <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-300">Te atiende <b>{datos.vendedor}</b></p>}
        </div>
      </header>

      {!datos.disponible && <Alerta tipo="info">{NO_DISPONIBLE[datos.motivo] || 'Este link no está disponible.'}</Alerta>}
      {datos.disponible && !datos.mercadopago_disponible && <Alerta tipo="info">{complejo.nombre} todavía no tiene habilitado el pago online.</Alerta>}

      <form onSubmit={comprar} className="grid gap-6 md:grid-cols-5" noValidate>
        <section className="card min-w-0 space-y-4 overflow-hidden md:col-span-3">
          {evento.imagen_evento && <img src={urlUpload(evento.imagen_evento)} alt="" className="-mx-5 -mt-5 mb-1 aspect-[21/9] w-[calc(100%+2.5rem)] max-w-none object-cover" />}
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{datos.producto}</h2>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
              <span>{evento.nombre} · {evento.tipo}</span>
              <span className="flex items-center gap-1.5"><CalendarBlank size={16} weight="duotone" aria-hidden /> {fecha(evento.fecha)}</span>
              {evento.lugar && <span className="flex items-center gap-1.5"><MapPin size={16} weight="duotone" aria-hidden /> {evento.lugar}</span>}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-zinc-900/5 dark:ring-white/5">
            <span className="font-medium">Precio <span className="text-indigo-600 tabular-nums dark:text-indigo-400">{moneda(datos.precio)}</span></span>
            {datos.cantidad_fija ? (
              <span className="text-sm font-medium tabular-nums">{cantidad} entrada{cantidad === 1 ? '' : 's'}</span>
            ) : (
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => setCantidad(Math.max(1, cantidad - 1))} disabled={cantidad <= 1} aria-label="Quitar una entrada"
                  className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-zinc-900/10 transition-transform duration-150 active:scale-[0.92] disabled:opacity-40 dark:ring-white/15"><Minus size={16} weight="bold" aria-hidden /></button>
                <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">{cantidad}</span>
                <button type="button" onClick={() => setCantidad(Math.min(datos.cantidad_maxima, cantidad + 1))} disabled={cantidad >= datos.cantidad_maxima} aria-label="Agregar una entrada"
                  className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-white transition-transform duration-150 active:scale-[0.92] disabled:opacity-40"><Plus size={16} weight="bold" aria-hidden /></button>
              </span>
            )}
          </div>
          {datos.reutilizable && datos.disponible && <p className="text-xs text-zinc-500 dark:text-zinc-400">Quedan {datos.stock_disponible} entradas en este link.</p>}
        </section>

        <aside className="card min-w-0 space-y-4 p-6 md:col-span-2">
          <h2 className="text-lg font-semibold">Tus datos</h2>
          <Alerta onClose={() => setError('')}>{error}</Alerta>
          <div>
            <label className="label" htmlFor="vl-nombre">Nombre y apellido</label>
            <input id="vl-nombre" className="input" autoComplete="name" maxLength={80} value={comprador.nombre} onChange={(e) => setComprador({ ...comprador, nombre: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="vl-email">Email</label>
            <input id="vl-email" className="input" type="email" autoComplete="email" inputMode="email" value={comprador.email} onChange={(e) => setComprador({ ...comprador, email: e.target.value })} required />
          </div>
          <WhatsappInput label="Teléfono (WhatsApp)" value={comprador.telefono} onChange={(telefono) => setComprador({ ...comprador, telefono })} onValidez={setTelefonoOk} />
          <div className="flex items-baseline justify-between border-t border-zinc-100 pt-4 dark:border-white/10">
            <span className="font-medium">Total</span>
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{moneda(datos.precio * cantidad)}</span>
          </div>
          <button className="btn-primary w-full py-3!" disabled={!listo || enviando}>
            <Wallet size={18} weight="bold" aria-hidden /> {enviando ? 'Abriendo MercadoPago…' : 'Comprar'}
          </button>
          <p className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <LockKey size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            Pagás en MercadoPago directamente a {complejo.nombre}. Las entradas con QR te llegan por WhatsApp.
          </p>
        </aside>
      </form>
    </div>
  );
}
