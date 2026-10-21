import { useEffect, useState } from 'react';
import { linksPagoApi, mensajeError, vendedorApi } from '../../api/client';
import GenerarLinkPago from '../../components/vendedor/GenerarLinkPago';
import GenerarLinkCheckout from '../../components/vendedor/GenerarLinkCheckout';
import { Alerta, Badge, Modal, Spinner, Tabs } from '../../components/ui';
import WhatsappInput from '../../components/WhatsappInput';
import { fecha, importe, moneda } from '../../utils/format';
import { ChatCircleDots, ShareNetwork } from '@phosphor-icons/react';

const Stat = ({ label, valor }) => (
  <div className="card p-4!">
    <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
    <p className="mt-1 text-2xl font-bold">{valor}</p>
  </div>
);

/** Panel del punto de venta: links únicos para compartir y ventas atribuidas. */
export default function VendedorPanel() {
  const [perfil, setPerfil] = useState(null);
  const [links, setLinks] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [nuevo, setNuevo] = useState({ id_evento: '', descripcion: '' });
  const [tab, setTab] = useState('cobrar');
  const [linksPago, setLinksPago] = useState([]);
  const [modoCobro, setModoCobro] = useState('checkout'); // checkout (el cliente completa) | compra (la carga el vendedor)
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [envio, setEnvio] = useState(null); // { link, whatsapp, mensaje }
  const [whatsappOk, setWhatsappOk] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = async () => {
    try {
      const [p, l, v, e, lp] = await Promise.all([vendedorApi.perfil(), vendedorApi.links(), vendedorApi.ventas(), vendedorApi.eventos(), linksPagoApi.listar()]);
      setPerfil(p); setLinks(l); setVentas(v); setEventos(e); setLinksPago(lp);
    } catch (err) {
      setError(mensajeError(err));
    }
  };
  useEffect(() => { cargar(); }, []);

  const crearLink = async (e) => {
    e.preventDefault();
    try {
      const link = await vendedorApi.crearLink({ id_evento: nuevo.id_evento || null, descripcion: nuevo.descripcion });
      setAviso(`Link creado: ${link.url}`);
      setNuevo({ id_evento: '', descripcion: '' });
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const toggle = async (l) => {
    try { await vendedorApi.actualizarLink(l.id_link, { activo: !l.activo }); cargar(); } catch (err) { setError(mensajeError(err)); }
  };

  const copiar = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setAviso('Link copiado al portapapeles');
    } catch {
      setAviso(url);
    }
  };

  const compartirWhatsapp = (l) => {
    const texto = `¡Conseguí tus entradas${l.evento ? ` para ${l.evento}` : ''} en ${perfil.tenant.nombre}! 🎟️ ${l.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };

  const enviarPorBot = async (e) => {
    e.preventDefault();
    if (!whatsappOk) return;
    setEnviando(true);
    try {
      const r = await vendedorApi.enviarLink(envio.link.id_link, { whatsapp: envio.whatsapp, mensaje: envio.mensaje });
      setAviso(r.mensaje);
      setEnvio(null);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  if (!perfil) return error ? <Alerta>{error}</Alerta> : <Spinner />;
  const botDisponible = perfil.chatbot?.disponible;

  const pagadas = ventas.filter((v) => v.estado === 'pagado');
  const total = pagadas.reduce((s, v) => s + Number(v.monto_total), 0);
  const entradas = pagadas.reduce((s, v) => s + v.cantidad_tickets, 0);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Hola, {perfil.nombre}</h1>
        <p className="text-zinc-500 dark:text-zinc-400">Punto de venta de {perfil.tenant.nombre} · WhatsApp {perfil.whatsapp}</p>
        {!botDisponible && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">El WhatsApp del complejo no está conectado: podés compartir tus links, pero no enviarlos desde el bot.</p>}
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Ventas pagadas" valor={pagadas.length} />
        <Stat label="Entradas vendidas" valor={entradas} />
        <Stat label="Total vendido" valor={importe(total)} />
        <Stat label="Visitas a mis links" valor={links.reduce((s, l) => s + l.visitas, 0)} />
      </div>

      <Tabs tabs={[['cobrar', 'Link de pago'], ['pagos', `Links de pago (${linksPago.length})`], ['links', `Links de venta (${links.length})`], ['ventas', `Mis ventas (${ventas.length})`]]} activa={tab} onChange={setTab} />

      {tab === 'cobrar' && (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Tipo de link" className="inline-flex rounded-full bg-zinc-100 p-1 text-sm dark:bg-white/5">
            {[['checkout', 'Link para el cliente'], ['compra', 'Cargar la compra']].map(([clave, texto]) => (
              <button key={clave} type="button" role="radio" aria-checked={modoCobro === clave} onClick={() => setModoCobro(clave)}
                className={`rounded-full px-4 py-1.5 font-medium transition-[background-color,box-shadow] duration-150 ${modoCobro === clave ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>
                {texto}
              </button>
            ))}
          </div>
          {modoCobro === 'checkout'
            ? <GenerarLinkCheckout eventos={eventos} mercadopago={(perfil.medios_pago || []).includes('mercadopago')} onGenerado={cargar} />
            : <GenerarLinkPago eventos={eventos} medios={perfil.medios_pago || []} onGenerado={cargar} />}
        </div>
      )}

      {tab === 'pagos' && (
        <div className="card overflow-x-auto p-0!">
          <table className="tabla">
            <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
              <tr><th className="p-3">#</th><th className="p-3">Comprador</th><th className="p-3">Evento</th><th className="p-3">Pago</th><th className="p-3">Total</th><th className="p-3">Estado</th><th className="p-3">Link</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {linksPago.map((l) => (
                <tr key={l.id_venta}>
                  <td className="p-3">{l.id_venta}<div className="text-xs text-zinc-400 dark:text-zinc-500">{fecha(l.fecha_venta)}</div></td>
                  <td className="p-3">{l.comprador}</td>
                  <td className="p-3">{l.evento}</td>
                  <td className="p-3">{l.tipo_pago === 'efectivo' ? 'Efectivo' : 'MercadoPago'}</td>
                  <td className="p-3 tabular-nums">{moneda(l.monto_total)}</td>
                  <td className="p-3"><Badge estado={l.estado} texto={l.estado === 'pendiente' && l.tipo_pago === 'efectivo' ? 'pendiente de validación' : l.estado} /></td>
                  <td className="p-3">{l.url && <button className="btn-secondary py-1!" onClick={() => copiar(l.url)}>Copiar</button>}</td>
                </tr>
              ))}
              {linksPago.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-zinc-400 dark:text-zinc-500">Todavía no generaste links de pago</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-6">
          <form onSubmit={crearLink} className="card grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div>
              <label className="label" htmlFor="campo-vendedorpanel-evento">Evento</label>
              <select id="campo-vendedorpanel-evento" className="input" value={nuevo.id_evento} onChange={(e) => setNuevo({ ...nuevo, id_evento: e.target.value })}>
                <option value="">Todos los eventos del complejo</option>
                {eventos.map((e) => <option key={e.id_evento} value={e.id_evento}>{e.nombre} · {fecha(e.fecha)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="campo-vendedorpanel-descripcion-opcional">Descripción (opcional)</label>
              <input id="campo-vendedorpanel-descripcion-opcional" className="input" placeholder="Ej. Instagram, grupo facultad…" maxLength={120} value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
            </div>
            <button className="btn-primary">+ Generar link</button>
          </form>

          <div className="space-y-3">
            {links.map((l) => (
              <div key={l.id_link} className={`card flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${l.activo ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <p className="font-medium">
                    {l.descripcion || 'Link'} · <span className="text-zinc-500 dark:text-zinc-400">{l.evento || 'Todos los eventos'}</span>
                  </p>
                  <p className="truncate font-mono text-sm text-indigo-700 dark:text-indigo-300">{l.checkout_url}</p>
                  {(l.tipo || l.cantidad) && <p className="text-xs text-zinc-500 dark:text-zinc-400">{l.tipo}{l.cantidad && ` · ${l.cantidad} entrada${l.cantidad === 1 ? '' : 's'}`}</p>}
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {l.visitas} visitas · {l.envios_whatsapp} envíos · {l.ventas_pagadas} ventas · {importe(l.monto_vendido)} · creado {fecha(l.creado_en)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button className="btn-secondary py-1!" onClick={() => copiar(l.checkout_url)} disabled={!l.activo}>Copiar</button>
                  <button className="btn-primary py-1!" onClick={() => { setEnvio({ link: l, whatsapp: '', mensaje: '' }); setWhatsappOk(null); }} disabled={!l.activo || !botDisponible}
                    title={botDisponible ? 'Enviar desde el WhatsApp del complejo' : 'El WhatsApp del complejo no está conectado'}><ChatCircleDots size={16} weight="bold" aria-hidden /> Enviar a cliente</button>
                  <button className="btn-secondary py-1!" onClick={() => compartirWhatsapp(l)} disabled={!l.activo}><ShareNetwork size={16} weight="bold" aria-hidden /> Compartir</button>
                  <button className="btn-secondary py-1!" onClick={() => toggle(l)}>{l.activo ? 'Pausar' : 'Activar'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {envio && (
        <Modal titulo="Enviar link por WhatsApp" onClose={() => setEnvio(null)}>
          <form onSubmit={enviarPorBot} className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Se envía desde el WhatsApp de <b>{perfil.tenant.nombre}</b> ({perfil.chatbot.provider}). Link: <span className="font-mono">{envio.link.url}</span></p>
            <WhatsappInput label="WhatsApp del cliente" value={envio.whatsapp} onChange={(whatsapp) => setEnvio({ ...envio, whatsapp })} onValidez={setWhatsappOk} />
            <div>
              <label className="label" htmlFor="campo-vendedorpanel-mensaje-opcional">Mensaje (opcional)</label>
              <textarea id="campo-vendedorpanel-mensaje-opcional" className="input" maxLength={500} rows={3} placeholder="¡Hola! Te paso el link para tus entradas" value={envio.mensaje} onChange={(e) => setEnvio({ ...envio, mensaje: e.target.value })} />
              <p className="mt-1 text-right text-xs text-zinc-400 dark:text-zinc-500">{envio.mensaje.length}/500 · el link se agrega al final</p>
            </div>
            <button className="btn-primary w-full" disabled={!whatsappOk || enviando}>{enviando ? 'Enviando…' : 'Enviar'}</button>
          </form>
        </Modal>
      )}

      {tab === 'ventas' && (
        <div className="card overflow-x-auto p-0!">
          <table className="tabla">
            <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
              <tr><th className="p-3">#</th><th className="p-3">Fecha</th><th className="p-3">Evento</th><th className="p-3">Comprador</th><th className="p-3">Entradas</th><th className="p-3">Total</th><th className="p-3">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {ventas.map((v) => (
                <tr key={v.id_venta}>
                  <td className="p-3">{v.id_venta}</td>
                  <td className="p-3">{fecha(v.fecha_venta)}</td>
                  <td className="p-3">{v.evento}</td>
                  <td className="p-3">{v.comprador}<div className="text-xs text-zinc-400 dark:text-zinc-500">{v.whatsapp}</div></td>
                  <td className="p-3">{v.cantidad_tickets}</td>
                  <td className="p-3">{moneda(v.monto_total)}</td>
                  <td className="p-3"><Badge estado={v.estado} /></td>
                </tr>
              ))}
              {ventas.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-zinc-400 dark:text-zinc-500">Todavía no hay ventas con tus links</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
