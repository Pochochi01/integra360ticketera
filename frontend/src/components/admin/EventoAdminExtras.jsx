import { useState } from 'react';
import { ArrowSquareOut, Check, ClockCounterClockwise, Copy, ShareNetwork } from '@phosphor-icons/react';
import { adminApi, mensajeError } from '../../api/client';
import WhatsappInput from '../WhatsappInput';
import { Alerta, Modal } from '../ui';
import { fecha, importe, moneda } from '../../utils/format';

const RAPIDOS = [10, 50, 100];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Agregar entradas a un tipo (ej. se agotaron las Early Bird): suma al cupo total y al disponible.
 * Nunca resta: las vendidas no se tocan. POST /api/admin/event/:id/update { agregar_stock }.
 */
export function AgregarEntradasModal({ evento, tipo, onListo, onClose }) {
  const [cantidad, setCantidad] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const n = Number(cantidad);
  const valido = Number.isInteger(n) && n >= 1 && n <= 100000;

  const guardar = async (e) => {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true);
    setError('');
    try {
      const actualizado = await adminApi.actualizarEvento(evento.id_evento, { agregar_stock: [{ id_tipo: tipo.id_tipo, cantidad: n }] });
      onListo(actualizado, `Se agregaron ${n} entradas a «${tipo.nombre_tipo}»`);
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={`Agregar entradas · ${tipo.nombre_tipo}`} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <Alerta onClose={() => setError('')}>{error}</Alerta>
        <div>
          <label className="label" htmlFor="agregar-cantidad">Cantidad a agregar</label>
          <input id="agregar-cantidad" className="input" type="number" min="1" max="100000" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          <div className="mt-2 flex gap-2">
            {RAPIDOS.map((r) => (
              <button key={r} type="button" className="btn-secondary flex-1 py-1!" onClick={() => setCantidad(String((Number(cantidad) || 0) + r))}>+{r}</button>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Disponibles</dt>
            <dd className="font-semibold tabular-nums">{tipo.stock_disponible}{valido && <span className="text-emerald-600 dark:text-emerald-400"> → {tipo.stock_disponible + n}</span>}</dd>
          </div>
          <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Cupo total</dt>
            <dd className="font-semibold tabular-nums">{tipo.stock_total}{valido && <span className="text-emerald-600 dark:text-emerald-400"> → {tipo.stock_total + n}</span>}</dd>
          </div>
        </dl>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Las entradas nuevas quedan a la venta al instante en todos los canales. El cambio queda registrado en el historial.</p>
        <button className="btn-primary w-full" disabled={!valido || enviando}>{enviando ? 'Agregando…' : valido ? `Agregar ${n} entradas` : 'Agregar entradas'}</button>
      </form>
    </Modal>
  );
}

/**
 * Venta directa desde el panel: el admin carga al comprador y obtiene el link de pago de MercadoPago
 * (cuenta del complejo) para enviárselo. Mismo checkout único que el resto de los canales: el stock se
 * descuenta recién cuando el comprador paga.
 */
export function CobroDirectoModal({ evento, onClose }) {
  const tipos = evento.tipos.filter((t) => t.activo && !t.solo_admin && t.stock_disponible > 0);
  const [form, setForm] = useState({ id_tipo: tipos[0]?.id_tipo || '', cantidad: 1, nombre: '', email: '', telefono: '' });
  const [telefonoOk, setTelefonoOk] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const tipo = tipos.find((t) => t.id_tipo === Number(form.id_tipo));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const listo = tipo && form.cantidad >= 1 && form.nombre.trim().length >= 2 && EMAIL_RE.test(form.email.trim()) && telefonoOk;

  const generar = async (e) => {
    e.preventDefault();
    if (!listo) return;
    setEnviando(true);
    setError('');
    try {
      setResultado(await adminApi.cobrarMercadoPago({
        event_id: evento.id_evento, items: [{ id_tipo: tipo.id_tipo, cantidad: Number(form.cantidad) }],
        comprador: { nombre: form.nombre.trim(), email: form.email.trim(), telefono: form.telefono },
      }));
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resultado.init_point);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { /* queda visible */ }
  };

  return (
    <Modal titulo="Cobrar con MercadoPago" onClose={onClose}>
      {resultado ? (
        <div className="space-y-4" data-testid="cobro-directo-resultado">
          <Alerta tipo="exito">Link de pago listo · {importe(resultado.monto_total)}. Las entradas se emiten cuando MercadoPago confirme el pago.</Alerta>
          <div className="flex items-center gap-2 rounded-xl bg-zinc-100 py-1.5 pl-3 pr-1.5 dark:bg-white/5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{resultado.init_point}</code>
            <button type="button" onClick={copiar} aria-label="Copiar link de pago" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 dark:text-zinc-400 dark:hover:bg-white/10">
              {copiado ? <Check size={18} weight="bold" className="text-emerald-600" aria-hidden /> : <Copy size={18} weight="bold" aria-hidden />}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <a className="btn-secondary" href={`https://wa.me/${form.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(`Tu link de pago para ${evento.nombre}: ${resultado.init_point}`)}`} target="_blank" rel="noreferrer"><ShareNetwork size={16} weight="bold" aria-hidden /> Enviar por WhatsApp</a>
            <a className="btn-secondary" href={resultado.init_point} target="_blank" rel="noreferrer"><ArrowSquareOut size={16} weight="bold" aria-hidden /> Abrir</a>
          </div>
          <button type="button" className="btn-primary w-full" onClick={() => { setResultado(null); setForm({ ...form, nombre: '', email: '', telefono: '' }); }}>Otro cobro</button>
        </div>
      ) : tipos.length === 0 ? (
        <Alerta tipo="info">No hay entradas disponibles para vender. Agregá entradas a un tipo primero.</Alerta>
      ) : (
        <form onSubmit={generar} className="space-y-4">
          <Alerta onClose={() => setError('')}>{error}</Alerta>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="cd-tipo">Entrada</label>
              <select id="cd-tipo" className="input" value={form.id_tipo} onChange={set('id_tipo')}>
                {tipos.map((t) => <option key={t.id_tipo} value={t.id_tipo}>{t.nombre_tipo} · {moneda(t.precio)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cd-cantidad">Cantidad</label>
              <input id="cd-cantidad" className="input" type="number" min="1" max={Math.min(tipo?.stock_disponible || 1, 50)} inputMode="numeric" value={form.cantidad} onChange={set('cantidad')} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="cd-nombre">Nombre y apellido del comprador</label>
            <input id="cd-nombre" className="input" autoComplete="off" maxLength={80} value={form.nombre} onChange={set('nombre')} required />
          </div>
          <div>
            <label className="label" htmlFor="cd-email">Email</label>
            <input id="cd-email" className="input" type="email" inputMode="email" autoComplete="off" value={form.email} onChange={set('email')} required />
          </div>
          <WhatsappInput label="Teléfono (WhatsApp)" value={form.telefono} onChange={(telefono) => setForm({ ...form, telefono })} onValidez={setTelefonoOk} />
          <div className="flex items-baseline justify-between border-t border-zinc-100 pt-3 dark:border-white/10">
            <span className="font-medium">Total</span>
            <span className="text-xl font-semibold tabular-nums">{importe((tipo?.precio || 0) * (Number(form.cantidad) || 0))}</span>
          </div>
          <button className="btn-primary w-full" disabled={!listo || enviando}>{enviando ? 'Generando…' : 'Generar link de pago'}</button>
        </form>
      )}
    </Modal>
  );
}

const CAMPOS = { nombre: 'nombre', fecha: 'fecha', lugar: 'lugar', descripcion: 'descripción', limite_por_persona: 'límite por persona' };

/** Historial de cambios del evento (auditoria_eventos): quién, cuándo y qué cambió. */
export function HistorialEvento({ auditoria = [] }) {
  if (!auditoria.length) return null;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
        <ClockCounterClockwise size={18} weight="duotone" className="text-zinc-500" aria-hidden /> Historial de cambios
        <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">({auditoria.length})</span>
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {auditoria.map((a) => (
          <li key={a.id} className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{fecha(a.creado_en)} · {a.usuario || 'sistema'}</p>
            {a.accion === 'agregar_stock' ? (
              <p>+{a.detalle.cantidad} entradas a <b>{a.detalle.tipo}</b> <span className="tabular-nums text-zinc-500 dark:text-zinc-400">({a.detalle.stock_total.antes} → {a.detalle.stock_total.despues})</span></p>
            ) : (
              Object.entries(a.detalle).map(([c, d]) => (
                <p key={c} className="min-w-0 break-words">{CAMPOS[c] || c}: <span className="text-zinc-500 line-through dark:text-zinc-400">{String(d.antes ?? '—')}</span> → {String(d.despues ?? '—')}</p>
              ))
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
