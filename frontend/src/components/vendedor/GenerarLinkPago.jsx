import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Copy, Money, ShareNetwork, Wallet } from '@phosphor-icons/react';
import { eventosApi, linksPagoApi, mensajeError } from '../../api/client';
import { Alerta } from '../ui';
import WhatsappInput from '../WhatsappInput';
import { fecha, importe, moneda } from '../../utils/format';

/**
 * El vendedor arma la compra de un cliente (evento, entradas, datos del comprador), elige la modalidad
 * de pago y obtiene un link para enviarle:
 *   - MercadoPago (por defecto): link de Checkout Pro; el dinero va a la cuenta del complejo.
 *   - Efectivo (sólo si el admin lo habilitó): reserva pendiente; las entradas no sirven para ingresar
 *     hasta que el complejo confirme el cobro.
 */
const MODALIDADES = {
  mercadopago: { icono: Wallet, titulo: 'MercadoPago', detalle: 'El cliente paga online. Se acredita al instante.' },
  efectivo: { icono: Money, titulo: 'Efectivo', detalle: 'Reserva pendiente: las entradas se habilitan cuando el complejo valide el cobro.' },
};

export default function GenerarLinkPago({ eventos, medios, onGenerado }) {
  const reducir = useReducedMotion();
  const [idEvento, setIdEvento] = useState('');
  const [evento, setEvento] = useState(null);
  const [cantidades, setCantidades] = useState({});
  const [comprador, setComprador] = useState({ nombre: '', whatsapp: '', email: '' });
  const [whatsappOk, setWhatsappOk] = useState(null);
  const [tipoPago, setTipoPago] = useState('mercadopago');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [copiado, setCopiado] = useState(false);

  // Por defecto MercadoPago; si el complejo no lo tiene conectado pero sí efectivo, queda efectivo
  useEffect(() => {
    if (!medios.includes(tipoPago) && medios.length) setTipoPago(medios.includes('mercadopago') ? 'mercadopago' : medios[0]);
  }, [medios, tipoPago]);

  useEffect(() => {
    setEvento(null);
    setCantidades({});
    if (idEvento) eventosApi.detalle(idEvento).then(setEvento).catch((e) => setError(mensajeError(e)));
  }, [idEvento]);

  const tipos = useMemo(() => (evento?.tipos || []).filter((t) => t.activo && !t.solo_admin), [evento]);
  const items = Object.entries(cantidades).filter(([, n]) => n > 0).map(([id_tipo, cantidad]) => ({ id_tipo: Number(id_tipo), cantidad }));
  const total = tipos.reduce((s, t) => s + Number(t.precio) * (cantidades[t.id_tipo] || 0), 0);
  const listo = idEvento && items.length && comprador.nombre.trim() && whatsappOk && medios.includes(tipoPago) && !evento?.tiene_seating;

  const generar = async (e) => {
    e.preventDefault();
    if (!listo) return;
    setEnviando(true);
    setError('');
    try {
      const r = await linksPagoApi.generar({
        tipo_pago: tipoPago, id_evento: Number(idEvento), items,
        comprador: { nombre: comprador.nombre.trim(), whatsapp: comprador.whatsapp, email: comprador.email.trim() || undefined },
      });
      setResultado(r);
      setCantidades({});
      setComprador({ nombre: '', whatsapp: '', email: '' });
      onGenerado?.(r);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resultado.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { /* el link queda visible para copiarlo a mano */ }
  };

  const compartir = () => {
    const v = resultado.venta;
    const texto = resultado.tipo_pago === 'efectivo'
      ? `Hola ${v.comprador}, te reservé ${resultado.tickets.length} entrada(s) para ${v.evento} (${moneda(v.monto_total)}). Abonalas en efectivo antes del ${fecha(v.expira_en)}. Tu reserva: ${resultado.url}`
      : `Hola ${v.comprador}, acá tenés el link para pagar tus entradas de ${v.evento} (${moneda(v.monto_total)}) con MercadoPago: ${resultado.url}`;
    window.open(`https://wa.me/${(v.whatsapp || '').replace('+', '')}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };

  if (!medios.length) {
    return <Alerta tipo="info">El complejo todavía no tiene MercadoPago conectado ni el pago en efectivo habilitado. Pedile al administrador que lo configure para generar links de pago.</Alerta>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form onSubmit={generar} className="card min-w-0 space-y-5 lg:col-span-3" aria-labelledby="titulo-link-pago">
        <h2 id="titulo-link-pago" className="text-lg font-semibold">Generar link de pago</h2>
        <Alerta onClose={() => setError('')}>{error}</Alerta>

        <div>
          <label className="label" htmlFor="lp-evento">Evento</label>
          <select id="lp-evento" className="input" value={idEvento} onChange={(e) => setIdEvento(e.target.value)} required>
            <option value="">Elegí un evento…</option>
            {eventos.filter((ev) => ev.estado === 'publicado').map((ev) => <option key={ev.id_evento} value={ev.id_evento}>{ev.nombre} · {fecha(ev.fecha)}</option>)}
          </select>
        </div>

        {!!evento?.tiene_seating && <Alerta tipo="info">Este evento tiene asientos numerados: el cliente tiene que comprar desde tu link de venta para elegir sus lugares.</Alerta>}

        {tipos.length > 0 && !evento?.tiene_seating && (
          <fieldset className="space-y-2">
            <legend className="label">Entradas</legend>
            {tipos.map((t) => (
              <div key={t.id_tipo} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t.nombre_tipo}</span>
                  <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{moneda(t.precio)} · {t.stock_disponible} disponibles</span>
                </span>
                <input
                  type="number" min="0" max={t.stock_disponible} inputMode="numeric" className="input w-20! text-center tabular-nums"
                  aria-label={`Cantidad ${t.nombre_tipo}`} value={cantidades[t.id_tipo] || 0}
                  onChange={(e) => setCantidades({ ...cantidades, [t.id_tipo]: Math.max(0, Math.min(t.stock_disponible, Number(e.target.value) || 0)) })}
                />
              </div>
            ))}
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="lp-nombre">Nombre del comprador</label>
            <input id="lp-nombre" className="input" maxLength={80} value={comprador.nombre} onChange={(e) => setComprador({ ...comprador, nombre: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="lp-email">Email (opcional)</label>
            <input id="lp-email" className="input" type="email" value={comprador.email} onChange={(e) => setComprador({ ...comprador, email: e.target.value })} />
          </div>
        </div>
        <WhatsappInput label="WhatsApp del comprador" value={comprador.whatsapp} onChange={(whatsapp) => setComprador({ ...comprador, whatsapp })} onValidez={setWhatsappOk} />

        <fieldset>
          <legend className="label">Modalidad de pago</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {Object.entries(MODALIDADES).map(([clave, m]) => {
              const habilitada = medios.includes(clave);
              const activa = tipoPago === clave;
              return (
                <label key={clave}
                  className={`relative flex cursor-pointer gap-3 rounded-2xl p-3 ring-1 transition-[box-shadow,background-color] duration-150 ${activa ? 'bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'ring-zinc-900/10 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5'} ${habilitada ? '' : 'cursor-not-allowed opacity-50'}`}>
                  <input type="radio" name="tipo_pago" value={clave} className="sr-only" checked={activa} disabled={!habilitada} onChange={() => setTipoPago(clave)} />
                  <m.icono size={24} weight="duotone" className={activa ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500'} aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-medium">{m.titulo}{clave === 'mercadopago' && <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">(por defecto)</span>}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {habilitada ? m.detalle : clave === 'efectivo' ? 'No habilitado por el complejo' : 'El complejo no tiene MercadoPago conectado'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900/5 pt-4 dark:border-white/5">
          <p className="text-sm">Total <b className="text-lg tabular-nums">{importe(total)}</b></p>
          <button className="btn-primary" disabled={!listo || enviando}>
            {enviando ? 'Generando…' : tipoPago === 'efectivo' ? 'Generar link de efectivo' : 'Generar link de MercadoPago'}
          </button>
        </div>
      </form>

      <div className="min-w-0 lg:col-span-2" aria-live="polite">
        <AnimatePresence mode="wait">
          {resultado ? (
            <motion.div
              key={resultado.venta.id_venta}
              initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
              className="card space-y-4"
              data-testid="resultado-link"
            >
              <Alerta tipo={resultado.tipo_pago === 'efectivo' ? 'info' : 'exito'}>{resultado.mensaje}</Alerta>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">Comprador</dt><dd className="truncate font-medium">{resultado.venta.comprador}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">Evento</dt><dd className="truncate">{resultado.venta.evento}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">Total</dt><dd className="tabular-nums">{moneda(resultado.venta.monto_total)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">Reserva hasta</dt><dd>{fecha(resultado.venta.expira_en)}</dd></div>
              </dl>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-100 py-1.5 pl-3 pr-1.5 dark:bg-white/5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="url-link">{resultado.url}</code>
                <button type="button" onClick={copiar} aria-label="Copiar link"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 transition-[transform,background-color] duration-150 hover:bg-zinc-900/5 active:scale-[0.94] dark:text-zinc-400 dark:hover:bg-white/10">
                  {copiado ? <Check size={18} weight="bold" className="text-emerald-600" aria-hidden /> : <Copy size={18} weight="bold" aria-hidden />}
                </button>
              </div>
              <button type="button" className="btn-secondary w-full" onClick={compartir}><ShareNetwork size={16} weight="bold" aria-hidden /> Enviar por WhatsApp</button>
              {resultado.tipo_pago === 'efectivo' && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Cuando recibas el efectivo, avisale al complejo: el administrador valida el cobro y recién ahí las entradas sirven para ingresar.</p>
              )}
            </motion.div>
          ) : (
            <motion.div key="vacio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-white/15 dark:text-zinc-400">
              Elegí el evento, las entradas y los datos del cliente. El link aparece acá para copiarlo o mandarlo por WhatsApp.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
