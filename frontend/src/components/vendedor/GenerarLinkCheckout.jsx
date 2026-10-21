import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowSquareOut, Check, Copy, ShareNetwork } from '@phosphor-icons/react';
import { eventosApi, linksPagoApi, mensajeError } from '../../api/client';
import { Alerta } from '../ui';
import { fecha } from '../../utils/format';

/**
 * El vendedor genera un link de checkout (/checkout/:linkId) para enviar a su cliente. El link abre la
 * página del complejo; el cliente completa sus datos y paga en MercadoPago, en la cuenta del complejo.
 * El producto es opcional: evento, tipo de entrada y cantidad fija.
 */
export default function GenerarLinkCheckout({ eventos, mercadopago, onGenerado }) {
  const reducir = useReducedMotion();
  const [form, setForm] = useState({ id_evento: '', id_tipo: '', cantidad: '', descripcion: '' });
  const [tipos, setTipos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    setTipos([]);
    if (form.id_evento) eventosApi.detalle(form.id_evento).then((e) => setTipos(e.tipos || [])).catch(() => {});
  }, [form.id_evento]);

  const generar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      const r = await linksPagoApi.generarCheckout({
        id_evento: form.id_evento ? Number(form.id_evento) : undefined,
        id_tipo: form.id_tipo ? Number(form.id_tipo) : undefined,
        cantidad: form.cantidad ? Number(form.cantidad) : undefined,
        descripcion: form.descripcion || undefined,
      });
      setResultado(r);
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
    } catch { /* queda visible para copiar a mano */ }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value, ...(k === 'id_evento' ? { id_tipo: '' } : {}) });

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form onSubmit={generar} className="card min-w-0 space-y-4 lg:col-span-3">
        <div>
          <h2 className="text-lg font-semibold">Link para el cliente</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Abre la página del complejo: el cliente elige, completa sus datos y paga con MercadoPago.</p>
        </div>
        {!mercadopago && <Alerta tipo="info">El complejo todavía no tiene MercadoPago conectado: el cliente no va a poder pagar hasta que el administrador lo conecte.</Alerta>}
        <Alerta onClose={() => setError('')}>{error}</Alerta>
        <div>
          <label className="label" htmlFor="ck-evento">Evento</label>
          <select id="ck-evento" className="input" value={form.id_evento} onChange={set('id_evento')}>
            <option value="">Todos los eventos del complejo</option>
            {eventos.filter((ev) => ev.estado === 'publicado').map((ev) => <option key={ev.id_evento} value={ev.id_evento}>{ev.nombre} · {fecha(ev.fecha)}</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ck-tipo">Tipo de entrada</label>
            <select id="ck-tipo" className="input" value={form.id_tipo} onChange={set('id_tipo')} disabled={!form.id_evento}>
              <option value="">El cliente elige</option>
              {tipos.map((t) => <option key={t.id_tipo} value={t.id_tipo}>{t.nombre_tipo}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ck-cantidad">Cantidad</label>
            <input id="ck-cantidad" className="input" type="number" min="1" max="50" inputMode="numeric" placeholder="El cliente elige" value={form.cantidad} onChange={set('cantidad')} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ck-descripcion">Referencia (opcional)</label>
          <input id="ck-descripcion" className="input" maxLength={120} placeholder="Ej. Juan · mesa 4" value={form.descripcion} onChange={set('descripcion')} />
        </div>
        <button className="btn-primary" disabled={enviando}>{enviando ? 'Generando…' : 'Generar link de checkout'}</button>
      </form>

      <div className="min-w-0 lg:col-span-2" aria-live="polite">
        <AnimatePresence mode="wait">
          {resultado ? (
            <motion.div key={resultado.link_id} className="card space-y-4" data-testid="resultado-checkout"
              initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
              <Alerta tipo="exito">{resultado.mensaje}</Alerta>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {resultado.evento || 'Todos los eventos'}{resultado.tipo && ` · ${resultado.tipo}`}{resultado.cantidad && ` · ${resultado.cantidad} entrada${resultado.cantidad === 1 ? '' : 's'}`}
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-100 py-1.5 pl-3 pr-1.5 dark:bg-white/5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="url-checkout">{resultado.url}</code>
                <button type="button" onClick={copiar} aria-label="Copiar link de checkout"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 transition-[transform,background-color] duration-150 hover:bg-zinc-900/5 active:scale-[0.94] dark:text-zinc-400 dark:hover:bg-white/10">
                  {copiado ? <Check size={18} weight="bold" className="text-emerald-600" aria-hidden /> : <Copy size={18} weight="bold" aria-hidden />}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <a className="btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(`Comprá tus entradas acá: ${resultado.url}`)}`} target="_blank" rel="noreferrer"><ShareNetwork size={16} weight="bold" aria-hidden /> WhatsApp</a>
                <a className="btn-secondary" href={resultado.url} target="_blank" rel="noreferrer"><ArrowSquareOut size={16} weight="bold" aria-hidden /> Ver página</a>
              </div>
            </motion.div>
          ) : (
            <motion.div key="vacio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-white/15 dark:text-zinc-400">
              El link queda listo para enviar. Lo podés usar las veces que quieras: cada compra se acredita en la cuenta del complejo.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
