import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarBlank, LockKey, MapPin, Minus, Plus, Storefront, Ticket, Wallet } from '@phosphor-icons/react';
import { mensajeError, pagosApi, publicoApi, urlUpload } from '../api/client';
import { Alerta, Skeleton, Vacio } from '../components/ui';
import WhatsappInput from '../components/WhatsappInput';
import { fecha, importe, moneda } from '../utils/format';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOTIVOS = {
  seating: 'Este evento tiene asientos numerados: comprá desde la cartelera para elegir tu ubicación.',
  agotado: 'Las entradas están agotadas.',
  no_disponible: 'El evento no está a la venta en este momento.',
};

/**
 * Compra rápida desde el QR de la puerta: /comprar/evento/:idEvento (todos los tipos) o /comprar/:idEvento/:tipo
 * (un tipo, ya elegido). Pensada para completarse en segundos desde el celular: elegir, 3 datos (autocompletables)
 * y pagar con MercadoPago en la cuenta del complejo. Al aprobarse, la entrada aparece en /entrada/:token y llega
 * por correo y WhatsApp.
 */
export default function CompraRapida() {
  const { idEvento, tipo: slug } = useParams();
  const [params] = useSearchParams();
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [error, setError] = useState(params.get('pago') === 'rechazado' ? 'MercadoPago rechazó el pago. Probá de nuevo con otro medio.' : '');
  const [idTipo, setIdTipo] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [comprador, setComprador] = useState({ nombre: '', email: '', telefono: '' });
  const [telefonoOk, setTelefonoOk] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    publicoApi.compraRapida(idEvento, slug)
      .then((d) => {
        setDatos(d);
        const disponibles = d.tipos.filter((t) => t.disponible);
        if (disponibles.length === 1) setIdTipo(disponibles[0].id_tipo); // un solo tipo (o QR por tipo): ya elegido
      })
      .catch((e) => setErrorCarga(mensajeError(e)));
  }, [idEvento, slug]);

  if (errorCarga) return <div className="mx-auto max-w-md py-12"><Vacio icono={Storefront} titulo="Compra no disponible">{errorCarga}</Vacio></div>;
  if (!datos) return <div className="mx-auto max-w-lg space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const { evento, complejo } = datos;
  const tipo = datos.tipos.find((t) => t.id_tipo === idTipo);
  const total = tipo ? tipo.precio * cantidad : 0;
  const datosOk = comprador.nombre.trim().length >= 2 && EMAIL_RE.test(comprador.email.trim()) && telefonoOk;
  const listo = datos.vendible && datos.mercadopago_disponible && tipo && datosOk && !enviando;

  const elegir = (t) => { setIdTipo(t.id_tipo); setCantidad(1); };
  const pagar = async (e) => {
    e.preventDefault();
    if (!listo) return;
    setEnviando(true);
    setError('');
    try {
      const r = await pagosApi.crear({
        event_id: evento.id_evento, origen: 'puerta_qr', items: [{ id_tipo: tipo.id_tipo, cantidad }],
        comprador: { nombre: comprador.nombre.trim(), email: comprador.email.trim(), telefono: comprador.telefono },
      });
      window.location.href = r.init_point; // checkout de MercadoPago del complejo
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={pagar} className="mx-auto max-w-lg space-y-5 pb-28" noValidate>
      {/* Evento */}
      <header className="card overflow-hidden p-0!">
        {evento.imagen_evento && <img src={urlUpload(evento.imagen_evento)} alt="" className="aspect-[2/1] w-full object-cover" />}
        <div className="flex items-start gap-3 p-5">
          {complejo.logo_url ? (
            <img src={complejo.logo_url} alt={`Logo de ${complejo.nombre}`} className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-zinc-900/10 dark:ring-white/10" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-semibold text-white" style={{ backgroundColor: complejo.color || '#4f46e5' }} aria-hidden>{complejo.nombre.slice(0, 1)}</span>
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{complejo.nombre}</p>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">{evento.nombre}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"><CalendarBlank size={16} weight="duotone" aria-hidden /> {fecha(evento.fecha)}</p>
            {evento.lugar && <p className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"><MapPin size={16} weight="duotone" aria-hidden /> {evento.lugar}</p>}
          </div>
        </div>
      </header>

      <Alerta onClose={() => setError('')}>{error}</Alerta>
      {!datos.vendible && <Alerta tipo="info">{MOTIVOS[datos.motivo] || 'El evento no está a la venta.'}</Alerta>}
      {datos.vendible && !datos.mercadopago_disponible && <Alerta tipo="info">{complejo.nombre} todavía no tiene habilitado el pago online.</Alerta>}

      {datos.vendible && (
        <>
          {/* Tipos de entrada: tarjetas grandes para tocar */}
          <fieldset className="space-y-2">
            <legend className="mb-2 flex items-center gap-2 text-lg font-semibold"><Ticket size={20} weight="duotone" aria-hidden /> Elegí tu entrada</legend>
            {datos.tipos.map((t) => (
              <label key={t.id_tipo} className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl p-4 ring-1 transition-[box-shadow,background-color] duration-150 ${!t.disponible ? 'cursor-not-allowed opacity-50 ring-zinc-900/10 dark:ring-white/10' : idTipo === t.id_tipo ? 'cursor-pointer bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'cursor-pointer bg-white ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10'}`}>
                <input type="radio" name="tipo" className="sr-only" checked={idTipo === t.id_tipo} disabled={!t.disponible} onChange={() => elegir(t)} />
                <span className="min-w-0">
                  <span className="block font-semibold">{t.nombre}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {!t.disponible ? 'Agotada' : t.quedan ? `¡Últimas ${t.quedan}!` : 'Disponible'}{t.condiciones ? ` · ${t.condiciones}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-lg font-semibold tabular-nums">{moneda(t.precio)}</span>
              </label>
            ))}
          </fieldset>

          {tipo && (
            <div className="card flex items-center justify-between gap-3 p-4!">
              <span className="font-medium">Cantidad</span>
              <span className="flex items-center gap-3">
                <button type="button" onClick={() => setCantidad(Math.max(1, cantidad - 1))} disabled={cantidad <= 1} aria-label="Una entrada menos"
                  className="grid h-11 w-11 place-items-center rounded-full ring-1 ring-zinc-900/10 transition-transform duration-150 active:scale-[0.92] disabled:opacity-40 dark:ring-white/15"><Minus size={18} weight="bold" aria-hidden /></button>
                <span className="w-8 text-center text-xl font-semibold tabular-nums" aria-live="polite">{cantidad}</span>
                <button type="button" onClick={() => setCantidad(Math.min(tipo.maximo, cantidad + 1))} disabled={cantidad >= tipo.maximo} aria-label="Una entrada más"
                  className="grid h-11 w-11 place-items-center rounded-full bg-indigo-600 text-white transition-transform duration-150 active:scale-[0.92] disabled:opacity-40"><Plus size={18} weight="bold" aria-hidden /></button>
              </span>
            </div>
          )}

          {/* Datos: 3 campos con autocompletado del navegador */}
          <section className="card space-y-3 p-4!" aria-labelledby="titulo-datos">
            <h2 id="titulo-datos" className="font-semibold">Tus datos</h2>
            <div>
              <label className="label" htmlFor="cr-nombre">Nombre y apellido</label>
              <input id="cr-nombre" className="input" autoComplete="name" enterKeyHint="next" maxLength={80} value={comprador.nombre} onChange={(e) => setComprador({ ...comprador, nombre: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="cr-email">Email</label>
              <input id="cr-email" className="input" type="email" autoComplete="email" inputMode="email" enterKeyHint="next" autoCapitalize="none" value={comprador.email} onChange={(e) => setComprador({ ...comprador, email: e.target.value })} required />
            </div>
            <WhatsappInput label="WhatsApp" value={comprador.telefono} onChange={(telefono) => setComprador({ ...comprador, telefono })} onValidez={setTelefonoOk} />
            <p className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <LockKey size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden /> Pagás en MercadoPago a {complejo.nombre}. Tu entrada con QR aparece al instante y te llega por correo y WhatsApp.
            </p>
          </section>
        </>
      )}

      {/* Total + pagar: fijo abajo, siempre a mano del pulgar */}
      {datos.vendible && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-900/10 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-white/10 dark:bg-zinc-950/95">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="min-w-0">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total{tipo ? ` · ${cantidad} × ${tipo.nombre}` : ''}</p>
              <p className="text-xl font-semibold tabular-nums">{importe(total)}</p>
            </div>
            <button className="btn-primary ml-auto flex-1 py-3! text-base! sm:flex-none sm:px-6!" disabled={!listo} data-testid="pagar-mp">
              <Wallet size={20} weight="bold" aria-hidden /> {enviando ? 'Abriendo…' : 'Pagar con Mercado Pago'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
