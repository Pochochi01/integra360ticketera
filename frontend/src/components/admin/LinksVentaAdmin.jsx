import { useEffect, useState } from 'react';
import { Check, Copy, LinkSimple, ShareNetwork } from '@phosphor-icons/react';
import { eventosApi, mensajeError, salesLinksApi, vendedorApi } from '../../api/client';
import { Alerta, Badge, Modal } from '../ui';
import { fecha, moneda } from '../../utils/format';

/**
 * Links de venta del complejo (/venta/:linkId) para compartir en redes. Cada link vende un tipo de entrada
 * con precio y stock propios; el stock baja sólo cuando MercadoPago aprueba el pago.
 * Único: admite una sola venta aprobada. Reutilizable: vende hasta agotar el stock.
 */
// Por qué el evento frena las ventas aunque el link tenga stock (el link sigue siendo el mismo al resolverlo)
const PROBLEMAS = {
  evento_agotado: () => 'No se vende: el tipo de entrada del evento tiene stock 0. Subí el stock en Eventos y este mismo link vuelve a vender.',
  evento_reservado: (l) => `No se vende: el stock del evento está retenido por ${l.reservadas_evento} entrada(s) en checkouts sin pagar. Se libera solo al vencer la reserva (30 min), o subí el stock en Eventos.`,
  evento_pasado: () => 'No se vende: el evento ya ocurrió.',
  evento_no_publicado: () => 'No se vende: el evento no está publicado.',
  tipo_inactivo: () => 'No se vende: el tipo de entrada está desactivado en Eventos.',
};

// Misma pantalla para el admin y el vendedor; cambia de dónde salen los datos y qué se puede configurar
const FUENTES = {
  admin: {
    listar: salesLinksApi.listar, crear: salesLinksApi.crear, actualizar: salesLinksApi.actualizar, tickets: salesLinksApi.tickets,
    eventos: () => eventosApi.listarTodos(), titulo: 'Links de venta',
  },
  vendedor: {
    listar: vendedorApi.salesLinks, crear: vendedorApi.crearSalesLink, actualizar: vendedorApi.actualizarSalesLink, tickets: vendedorApi.ticketsSalesLink,
    eventos: () => vendedorApi.eventos(), titulo: 'Mis links reutilizables',
  },
};

/** modo 'vendedor': links propios del vendedor (vende al precio de lista; cada venta queda a su nombre). */
export default function LinksVentaAdmin({ modo = 'admin' }) {
  const fuente = FUENTES[modo];
  const esVendedor = modo === 'vendedor';
  const [links, setLinks] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [form, setForm] = useState({ id_evento: '', id_tipo: '', producto: '', precio: '', stock_total: '', reutilizable: true });
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [copiado, setCopiado] = useState(null);
  const [compras, setCompras] = useState(null);
  const [todos, setTodos] = useState(false);

  const cargar = () => fuente.listar().then(setLinks).catch((e) => setError(mensajeError(e)));
  useEffect(() => {
    cargar();
    fuente.eventos().then((evs) => setEventos(evs.filter((e) => e.estado === 'publicado'))).catch(() => {});
  }, []);
  useEffect(() => {
    setTipos([]);
    if (form.id_evento) eventosApi.detalle(form.id_evento).then((e) => setTipos((e.tipos || []).filter((t) => t.activo && !t.solo_admin))).catch(() => {});
  }, [form.id_evento]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value, ...(k === 'id_evento' ? { id_tipo: '' } : {}) });

  const generar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      const r = await fuente.crear({
        id_tipo: Number(form.id_tipo), stock_total: Number(form.stock_total), reutilizable: form.reutilizable,
        precio: !esVendedor && form.precio ? Number(form.precio) : undefined, producto: form.producto || undefined,
      });
      setAviso(r.aviso || 'Link de venta generado: ya lo podés compartir');
      setAbierto(false);
      setForm({ id_evento: '', id_tipo: '', producto: '', precio: '', stock_total: '', reutilizable: true });
      await cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async (l) => {
    try {
      await navigator.clipboard.writeText(l.url);
      setCopiado(l.id);
      setTimeout(() => setCopiado(null), 1500);
    } catch { /* la URL queda visible */ }
  };

  // En celulares abre el menú nativo para compartir (Instagram, Facebook, WhatsApp…); si no existe, sigue el link a WhatsApp
  const compartir = async (e, l) => {
    if (!navigator.share) return;
    e.preventDefault();
    try {
      await navigator.share({ title: l.producto, text: `Comprá tus entradas: ${l.producto}`, url: l.url });
    } catch { /* el usuario cerró el menú */ }
  };

  const pausar = async (l) => {
    try {
      await fuente.actualizar(l.id, { activo: !l.activo });
      await cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  const verCompras = async (l) => {
    try {
      setCompras({ link: l, filas: await fuente.tickets(l.id) });
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  const estado = (l) => {
    if (!l.activo) return { estado: 'cancelado', texto: 'Pausado' };
    if (l.stock_disponible <= 0) return { estado: 'agotado', texto: l.reutilizable ? 'Agotado' : 'Usado' };
    return { estado: 'pagado', texto: 'Activo' };
  };

  return (
    <section className="card mb-6 space-y-3" aria-labelledby="titulo-links-venta">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-links-venta" className="flex items-center gap-2 text-lg font-semibold">
          <LinkSimple size={22} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden /> {fuente.titulo}
        </h2>
        <button className="btn-primary py-1!" onClick={() => setAbierto(true)}>Generar link</button>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      {links.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Generá un link para compartir en redes. Cada pago se acredita en la cuenta de MercadoPago del complejo.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {links.map((l, i) => (
            <li key={l.id} className={`flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between ${!todos && i >= 3 ? 'hidden sm:flex' : 'flex'}`} data-testid={`sales-link-${l.id}`}>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">{l.producto} <Badge {...estado(l)} /></p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {!esVendedor && l.vendedor && <span className="text-indigo-700 dark:text-indigo-300">de {l.vendedor} · </span>}
                  {moneda(l.precio)} · {l.reutilizable ? 'reutilizable' : 'único'} · stock <b className="tabular-nums text-zinc-900 dark:text-white">{l.stock_disponible}/{l.stock_total}</b>
                  {' '}· {l.ventas_aprobadas} aprobada{l.ventas_aprobadas === 1 ? '' : 's'}{l.ventas_pendientes > 0 && ` · ${l.ventas_pendientes} pendiente${l.ventas_pendientes === 1 ? '' : 's'}`}
                </p>
                <code className="block truncate font-mono text-xs text-zinc-400 dark:text-zinc-500">{l.url}</code>
                {l.activo && l.stock_disponible > 0 && l.problema && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{PROBLEMAS[l.problema]?.(l)}</p>
                )}
                {l.activo && !l.problema && l.stock_evento < l.stock_disponible && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Al evento le quedan {l.stock_evento} entradas de este tipo: el link no puede vender más que eso.</p>
                )}
              </div>
              <div className="grid shrink-0 grid-cols-4 gap-2 sm:flex">
                <button className="btn-secondary py-1!" onClick={() => copiar(l)} aria-label={`Copiar link ${l.producto}`}>
                  {copiado === l.id ? <Check size={16} weight="bold" className="text-emerald-600" aria-hidden /> : <Copy size={16} weight="bold" aria-hidden />}
                </button>
                <a className="btn-secondary py-1!" href={`https://wa.me/?text=${encodeURIComponent(`${l.producto}: ${l.url}`)}`} target="_blank" rel="noreferrer"
                  aria-label="Compartir (Instagram, Facebook, WhatsApp…)" onClick={(e) => compartir(e, l)}>
                  <ShareNetwork size={16} weight="bold" aria-hidden />
                </a>
                <button className="btn-secondary py-1!" onClick={() => verCompras(l)}>Compras</button>
                <button className="btn-secondary py-1!" onClick={() => pausar(l)}>{l.activo ? 'Pausar' : 'Activar'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* En celular la lista se corta en 3 para no tapar las ventas */}
      {links.length > 3 && (
        <button type="button" className="btn-secondary w-full sm:hidden" onClick={() => setTodos(!todos)} aria-expanded={todos}>
          {todos ? 'Ver menos' : `Ver los ${links.length} links`}
        </button>
      )}

      {abierto && (
        <Modal titulo="Nuevo link de venta" onClose={() => setAbierto(false)}>
          <form onSubmit={generar} className="space-y-4">
            <div>
              <label className="label" htmlFor="sl-evento">Evento</label>
              <select id="sl-evento" className="input" value={form.id_evento} onChange={set('id_evento')} required>
                <option value="">Elegí un evento</option>
                {eventos.map((ev) => <option key={ev.id_evento} value={ev.id_evento}>{ev.nombre} · {fecha(ev.fecha)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sl-tipo">Tipo de entrada</label>
              <select id="sl-tipo" className="input" value={form.id_tipo} onChange={set('id_tipo')} disabled={!form.id_evento} required>
                <option value="">Elegí el tipo</option>
                {tipos.map((t) => <option key={t.id_tipo} value={t.id_tipo}>{t.nombre_tipo} · {moneda(t.precio)} · {t.stock_disponible} disp.</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sl-producto">Nombre del producto (opcional)</label>
              <input id="sl-producto" className="input" maxLength={120} placeholder="Ej. Preventa Instagram" value={form.producto} onChange={set('producto')} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {!esVendedor && (
              <div>
                <label className="label" htmlFor="sl-precio">Precio por entrada</label>
                <input id="sl-precio" className="input" type="number" min="1" step="0.01" inputMode="decimal" placeholder="El del tipo" value={form.precio} onChange={set('precio')} />
              </div>
              )}
              <div>
                <label className="label" htmlFor="sl-stock">{form.reutilizable ? 'Stock del link' : 'Entradas de la compra'}</label>
                <input id="sl-stock" className="input" type="number" min="1" max={form.reutilizable ? 100000 : 50} inputMode="numeric" value={form.stock_total} onChange={set('stock_total')} required />
              </div>
            </div>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="label">Modalidad</legend>
              {[[true, 'Reutilizable', 'Muchas compras hasta agotar el stock'], [false, 'Único', 'Una sola compra aprobada']].map(([v, titulo, desc]) => (
                <label key={titulo} className={`cursor-pointer rounded-xl p-3 text-sm ring-1 ${form.reutilizable === v ? 'bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'ring-zinc-900/10 dark:ring-white/10'}`}>
                  <input type="radio" name="modalidad" className="sr-only" checked={form.reutilizable === v} onChange={() => setForm({ ...form, reutilizable: v })} />
                  <span className="block font-medium">{titulo}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{desc}</span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">El stock del link se descuenta recién cuando MercadoPago confirma el pago.</p>
            <button className="btn-primary w-full" disabled={enviando}>{enviando ? 'Generando…' : 'Generar link'}</button>
          </form>
        </Modal>
      )}

      {compras && (
        <Modal titulo={`Compras · ${compras.link.producto}`} onClose={() => setCompras(null)} ancho="max-w-2xl">
          {compras.filas.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Todavía no hay compras.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
              {compras.filas.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.buyer_name}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t.buyer_email} · {t.cantidad} entrada{t.cantidad === 1 ? '' : 's'} · {moneda(t.monto_total)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs">{t.estado}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}
