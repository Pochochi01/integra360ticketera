import { useEffect, useState } from 'react';
import { adminApi, eventosApi, mensajeError, urlUpload, vendedoresApi, ventasApi } from '../../api/client';
import { Alerta, Badge, Spinner, useConfirmar } from '../../components/ui';
import { fecha, importe, moneda } from '../../utils/format';
import LinksVentaAdmin from '../../components/admin/LinksVentaAdmin';
import { mensajeEntradas, urlWhatsapp } from '../../utils/entradasWhatsapp';
import EventStatsModal, { Actualizado, REFRESCO_MS, useEstadisticasEvento } from '../../components/admin/EventStatsModal';
import { CalendarBlank, ChartBar, Handshake, MapPin, Money, PaperPlaneTilt, WhatsappLogo } from '@phosphor-icons/react';

export default function AdminVentas() {
  const confirmar = useConfirmar();
  const [ventas, setVentas] = useState(null);
  const [efectivo, setEfectivo] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [filtros, setFiltros] = useState({ estado: '', id_vendedor: '' });
  const [eventos, setEventos] = useState([]);
  const [idEvento, setIdEvento] = useState('');
  const [statsAbierto, setStatsAbierto] = useState(false);
  // Links de descarga por venta pagada (se piden al usarlos y quedan en caché): { [id_venta]: respuesta }
  const [linksPorVenta, setLinksPorVenta] = useState({});
  const [abiertos, setAbiertos] = useState({}); // ventas con la lista de links desplegada
  const [enviandoWa, setEnviandoWa] = useState(null);
  const [avisoWa, setAvisoWa] = useState({}); // { [id_venta]: mensaje } — se muestra junto al botón de esa venta
  const estadisticas = useEstadisticasEvento(idEvento);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = () =>
    Promise.all([
      ventasApi.listar({ estado: filtros.estado || undefined, id_vendedor: filtros.id_vendedor || undefined, id_evento: idEvento || undefined }).then(setVentas),
      ventasApi.listar({ metodo_pago: 'efectivo', estado: 'pendiente' }).then(setEfectivo),
    ]).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, [filtros, idEvento]);
  // Mismo ritmo que las estadísticas: los pagos que confirma MercadoPago aparecen solos en la lista
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && cargar(), REFRESCO_MS);
    return () => clearInterval(id);
  }, [filtros, idEvento]);
  useEffect(() => {
    vendedoresApi.listar().then(setVendedores).catch(() => {});
    eventosApi.listarTodos().then((evs) => setEventos([...evs].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)))).catch(() => {});
  }, []);

  const accion = async (fn, exito) => {
    setError('');
    try {
      await fn();
      await cargar();
      if (exito) setAviso(exito);
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  /** GET /api/admin/ventas/links/:id (una vez por venta). */
  const obtenerLinks = async (idVenta) => {
    if (linksPorVenta[idVenta]) return linksPorVenta[idVenta];
    const datos = await adminApi.linksVenta(idVenta);
    setLinksPorVenta((prev) => ({ ...prev, [idVenta]: datos }));
    return datos;
  };

  /** «Enviar por WhatsApp»: trae los links, arma el mensaje y abre wa.me en el dispositivo del admin. */
  const enviarPorWhatsapp = async (v) => {
    setAvisoWa((prev) => ({ ...prev, [v.id_venta]: null }));
    setEnviandoWa(v.id_venta);
    try {
      const d = await obtenerLinks(v.id_venta);
      const url = urlWhatsapp(d.buyer_phone, mensajeEntradas({ nombre: d.buyer_name, evento: d.evento, tickets: d.tickets }));
      if (!url) {
        // Junto al botón (el admin está mirando esa fila, no el principio de la página)
        setAvisoWa((prev) => ({ ...prev, [v.id_venta]: 'No se puede enviar por WhatsApp, falta número de teléfono.' }));
        return;
      }
      window.location.href = url; // abre WhatsApp (app en el celular, WhatsApp Web en la computadora)
    } catch (e) {
      setAvisoWa((prev) => ({ ...prev, [v.id_venta]: mensajeError(e) }));
    } finally {
      setEnviandoWa(null);
    }
  };

  const alternarLinks = async (v) => {
    const abrir = !abiertos[v.id_venta];
    setAbiertos((prev) => ({ ...prev, [v.id_venta]: abrir }));
    if (abrir) await obtenerLinks(v.id_venta).catch((e) => setError(mensajeError(e)));
  };

  if (!ventas) return <Spinner />;
  const recaudado = ventas.filter((v) => v.estado === 'pagado').reduce((s, v) => s + Number(v.monto_total), 0);

  return (
    <>
      <div className="mb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{ventas.length} ventas · recaudado {importe(recaudado)}</p>
        </div>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      {/* Evento seleccionado: datos principales y acceso a las estadísticas */}
      <section className="card mb-6 space-y-4" aria-labelledby="titulo-evento-ventas">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <label id="titulo-evento-ventas" className="label" htmlFor="ventas-evento">Evento</label>
            <select id="ventas-evento" className="input" value={idEvento} onChange={(e) => setIdEvento(e.target.value)}>
              <option value="">Todos los eventos</option>
              {eventos.map((ev) => <option key={ev.id_evento} value={ev.id_evento}>{ev.nombre} · {fecha(ev.fecha)}{ev.estado !== 'publicado' ? ` (${ev.estado})` : ''}</option>)}
            </select>
          </div>
          {idEvento && (
            <button className="btn-primary shrink-0" onClick={() => setStatsAbierto(true)} data-testid="boton-estadisticas">
              <ChartBar size={18} weight="bold" aria-hidden /> Estadísticas
            </button>
          )}
        </div>
        {idEvento && (estadisticas.stats ? (
          <div className="flex flex-col gap-4 sm:flex-row" data-testid="resumen-evento">
            {estadisticas.stats.evento.imagen_evento && <img src={urlUpload(estadisticas.stats.evento.imagen_evento)} alt="" className="aspect-[16/9] w-full rounded-xl object-cover sm:w-48" />}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">{estadisticas.stats.evento.nombre} <Badge estado={estadisticas.stats.evento.estado} /></p>
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5"><CalendarBlank size={16} weight="duotone" aria-hidden /> {fecha(estadisticas.stats.evento.fecha)}</span>
                  {estadisticas.stats.evento.lugar && <span className="flex items-center gap-1.5"><MapPin size={16} weight="duotone" aria-hidden /> {estadisticas.stats.evento.lugar}</span>}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Vendidas', estadisticas.stats.generales.unidades],
                  ['Stock disponible', `${estadisticas.stats.evento.stock_disponible} / ${estadisticas.stats.evento.stock_total}`],
                  ['Ingresos', importe(estadisticas.stats.generales.ingresos)],
                  ['Pagos en curso', estadisticas.stats.generales.pendientes.ventas],
                ].map(([t, v]) => (
                  <div key={t} className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5">
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{t}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <Actualizado en={estadisticas.stats.actualizado_en} cargando={estadisticas.cargando} onActualizar={estadisticas.actualizar} />
            </div>
          </div>
        ) : estadisticas.error ? <Alerta>{estadisticas.error}</Alerta> : <Spinner />)}
      </section>

      {statsAbierto && idEvento && (
        <EventStatsModal {...estadisticas} onActualizar={estadisticas.actualizar} onClose={() => setStatsAbierto(false)} />
      )}

      <LinksVentaAdmin />

      {/* Reservas en efectivo: sus tickets no sirven para ingresar hasta que el admin valida el cobro */}
      {efectivo.length > 0 && (
        <section className="card mb-6 space-y-3" aria-labelledby="titulo-efectivo-pendiente">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="titulo-efectivo-pendiente" className="flex items-center gap-2 text-lg font-semibold">
              <Money size={22} weight="duotone" className="text-amber-600 dark:text-amber-400" aria-hidden /> Pendientes de pago en efectivo
            </h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{efectivo.length} reserva{efectivo.length === 1 ? '' : 's'} · {importe(efectivo.reduce((s, v) => s + Number(v.monto_total), 0))}</span>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {efectivo.map((v) => (
              <li key={v.id_venta} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`efectivo-${v.id_venta}`}>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">#{v.id_venta} · {v.comprador} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {v.whatsapp_contacto}</span></p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {v.evento} · {v.cantidad_tickets} entrada{v.cantidad_tickets === 1 ? '' : 's'} · <b className="tabular-nums text-zinc-900 dark:text-white">{moneda(v.monto_total)}</b>
                    {v.vendedor && ` · vendió ${v.vendedor}`}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">Entradas no validadas · la reserva vence el {fecha(v.expira_en)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn-primary py-1!" onClick={async () => (await confirmar(`Confirmás que recibiste ${moneda(v.monto_total)} en efectivo. Las entradas quedan habilitadas para ingresar y se envían al comprador.`, { titulo: `Validar cobro #${v.id_venta}`, aceptar: 'Validar cobro' })) && accion(() => ventasApi.validarEfectivo(v.id_venta), 'Cobro en efectivo validado: las entradas ya sirven para ingresar')}>
                    Validar cobro
                  </button>
                  <button className="btn-secondary py-1!" onClick={async () => (await confirmar('Se liberan las entradas reservadas.', { titulo: `Cancelar reserva #${v.id_venta}`, aceptar: 'Cancelar reserva', peligro: true })) && accion(() => ventasApi.cancelar(v.id_venta), 'Reserva cancelada')}>
                    Cancelar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Listado de ventas</h2>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select className="input min-w-0 sm:w-auto!" value={filtros.id_vendedor} onChange={(e) => setFiltros({ ...filtros, id_vendedor: e.target.value })}>
            <option value="">Todos los canales</option>
            <option value="ninguno">Venta directa (sin vendedor)</option>
            {vendedores.map((v) => <option key={v.id_vendedor} value={v.id_vendedor}>{v.apellido}, {v.nombre}</option>)}
          </select>
          <select className="input min-w-0 sm:w-auto!" value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
            <option value="">Todos los estados</option>
            {['pendiente', 'pagado', 'cancelado', 'reembolsado'].map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
      </div>
      <div className="card overflow-x-auto p-0!">
        <table className="tabla">
          <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
            <tr><th className="p-3">#</th><th className="p-3">Comprador</th><th className="p-3">Evento</th><th className="p-3">Canal</th><th className="p-3">Tickets</th><th className="p-3">Total</th><th className="p-3">Pago</th><th className="p-3">Estado</th><th className="p-3" /></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {ventas.map((v) => (
              <tr key={v.id_venta}>
                <td className="p-3">{v.id_venta}<div className="text-xs text-zinc-400 dark:text-zinc-500">{fecha(v.fecha_venta)}</div></td>
                <td className="p-3">
                  {v.comprador}
                  <div className="text-xs text-zinc-400 dark:text-zinc-500">{v.email_comprador || 'sin email'}</div>
                  <div className="text-xs text-zinc-400 dark:text-zinc-500">{v.whatsapp_contacto || 'sin teléfono'}{v.whatsapp_enviado_en && <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><WhatsappLogo size={12} weight="fill" aria-hidden />enviado</span>}</div>
                  {v.estado === 'pagado' && (
                    <div className="mt-1">
                      <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => alternarLinks(v)} aria-expanded={!!abiertos[v.id_venta]} data-testid={`ver-links-${v.id_venta}`}>
                        {abiertos[v.id_venta] ? 'Ocultar links' : `Ver links de descarga (${v.cantidad_tickets})`}
                      </button>
                      {abiertos[v.id_venta] && (
                        <ul className="mt-1 space-y-0.5" data-testid={`links-${v.id_venta}`}>
                          {!linksPorVenta[v.id_venta] ? <li className="text-xs text-zinc-400">Cargando…</li> : linksPorVenta[v.id_venta].tickets.map((t) => (
                            <li key={t.ticketId} className="text-xs">
                              <a className="break-all text-indigo-600 hover:underline dark:text-indigo-400" href={`${t.link}?ver=1`} target="_blank" rel="noreferrer">Entrada {t.numero}{t.tipo ? ` · ${t.tipo}` : ''}</a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-3">{v.evento}</td>
                <td className="p-3">
                  {v.vendedor ? <><Handshake size={14} weight="duotone" className="mr-1 inline" aria-hidden />{v.vendedor}<div className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{v.codigo_link ? `/v/${v.codigo_link}` : 'link de pago'}</div></> : <span className="capitalize">{v.tipo_venta === 'normal' ? 'Directa' : v.tipo_venta}</span>}
                  {v.empresa && <div className="text-xs text-zinc-400 dark:text-zinc-500">{v.empresa}</div>}
                </td>
                <td className="p-3">{v.cantidad_tickets}</td>
                <td className="p-3">{moneda(v.monto_total)}</td>
                <td className="p-3">{{ mercadopago: 'MercadoPago', efectivo: 'Efectivo', transferencia: 'Transferencia', cortesia: 'Cortesía' }[v.metodo_pago] || v.metodo_pago}<div className="text-xs text-zinc-400 dark:text-zinc-500">{v.referencia_pago}</div></td>
                <td className="p-3"><Badge estado={v.estado} /></td>
                <td className="p-3 text-right">
                  {/* Las acciones pasan a otra línea si no entran (el botón de WhatsApp es ancho) */}
                  <div className="flex flex-wrap items-center justify-end gap-2 *:whitespace-nowrap">
                  {v.estado === 'pendiente' && v.metodo_pago !== 'mercadopago' && (
                    <button className="btn-primary py-1!" onClick={() => accion(() => ventasApi.confirmarPago(v.id_venta), 'Pago confirmado y entradas enviadas')}>{v.metodo_pago === 'efectivo' ? 'Validar cobro' : 'Confirmar pago'}</button>
                  )}
                  {v.estado === 'pagado' && (
                    <button className="btn-secondary py-1! text-emerald-700 dark:text-emerald-400" onClick={() => enviarPorWhatsapp(v)} disabled={enviandoWa === v.id_venta}
                      aria-label={`Enviar las entradas por WhatsApp a ${v.comprador}`} title="Abre WhatsApp con el mensaje y los links de las entradas" data-testid={`whatsapp-venta-${v.id_venta}`}>
                      <WhatsappLogo size={16} weight="fill" aria-hidden /> {enviandoWa === v.id_venta ? 'Abriendo…' : 'Enviar por WhatsApp'}
                    </button>
                  )}
                  {v.estado === 'pagado' && v.whatsapp_contacto && (
                    <button className="btn-secondary py-1!" onClick={() => accion(() => ventasApi.reenviarWhatsapp(v.id_venta), `Reenviado a ${v.whatsapp_contacto}`)} aria-label={`Reenviar las entradas desde el bot de WhatsApp del complejo a ${v.whatsapp_contacto}`} title="Reenviar desde el bot del complejo"><PaperPlaneTilt size={16} weight="bold" aria-hidden /></button>
                  )}
                  {['pendiente', 'pagado'].includes(v.estado) && (
                    <button className="btn-secondary py-1!" onClick={async () => (await confirmar(v.estado === 'pagado' ? `Se devuelve el dinero al comprador y se liberan sus entradas.` : `Se liberan las entradas reservadas.`, { titulo: `${v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar'} venta #${v.id_venta}`, aceptar: v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar venta', peligro: true })) && accion(() => ventasApi.cancelar(v.id_venta))}>
                      {v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar'}
                    </button>
                  )}
                  </div>
                  {avisoWa[v.id_venta] && (
                    <p role="alert" className="mt-2 text-left text-xs font-medium text-rose-700 sm:text-right dark:text-rose-300" data-testid={`aviso-wa-${v.id_venta}`}>{avisoWa[v.id_venta]}</p>
                  )}
                </td>
              </tr>
            ))}
            {ventas.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-zinc-400 dark:text-zinc-500">Sin ventas</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
