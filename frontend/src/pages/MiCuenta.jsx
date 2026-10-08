import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { eventosApi, mensajeError, ticketsApi, ventasApi } from '../api/client';
import { useTickets } from '../context/TicketsContext';
import { Alerta, Badge, Modal, Spinner, Tabs, useConfirmar, Vacio } from '../components/ui';
import TicketImagen from '../components/TicketImagen';
import TicketTarjeta from '../components/eventos/TicketTarjeta';
import Aparecer from '../components/landing/Aparecer';
import { fecha, moneda } from '../utils/format';
import { ArrowDownLeft, ArrowUpRight, PaperPlaneTilt, Ticket } from '@phosphor-icons/react';

export default function MiCuenta() {
  const confirmar = useConfirmar();
  const { state } = useLocation();
  const { tickets, ventas, transferencias, espera, cargando, refrescar } = useTickets();
  const [tab, setTab] = useState('tickets');
  const [aviso, setAviso] = useState(state?.mensaje || '');
  const [error, setError] = useState('');
  const [qrAbierto, setQrAbierto] = useState(null);
  const [transfiriendo, setTransfiriendo] = useState(null);
  const [emailDestino, setEmailDestino] = useState('');

  const ejecutar = async (fn, exito) => {
    setError('');
    try {
      await fn();
      setAviso(exito);
      await refrescar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  const transferir = async (e) => {
    e.preventDefault();
    await ejecutar(() => ticketsApi.transferir(transfiriendo.id_ticket, emailDestino), `Ticket transferido a ${emailDestino}`);
    setTransfiriendo(null);
    setEmailDestino('');
  };

  const cancelarVenta = async (v) => {
    if (await confirmar(v.estado === 'pagado' ? 'Te devolvemos el dinero y tus entradas dejan de ser válidas.' : 'Las entradas reservadas quedan libres.', { titulo: `${v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar'} compra #${v.id_venta}`, aceptar: v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar compra', cancelar: 'Volver', peligro: true })) {
      ejecutar(() => ventasApi.cancelar(v.id_venta), v.estado === 'pagado' ? 'Compra reembolsada' : 'Compra cancelada');
    }
  };

  const activos = tickets.filter((t) => ['valido', 'pendiente'].includes(t.estado));
  const historicos = tickets.filter((t) => !['valido', 'pendiente'].includes(t.estado));

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Mi cuenta</h1>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Tabs
        activa={tab}
        onChange={setTab}
        tabs={[['tickets', `Mis tickets (${activos.length})`], ['compras', 'Compras'], ['transferencias', 'Transferencias'], ['espera', 'Lista de espera']]}
      />
      {cargando && !tickets.length && <Spinner />}

      {tab === 'tickets' && (
        <>
          {activos.length === 0 && !cargando && (
            <Vacio icono={Ticket} titulo="Todavía no tenés entradas" accion={<Link to="/eventos" className="btn-primary mt-2">Ver eventos</Link>}>
              Cuando compres, tus entradas aparecen acá con su QR.
            </Vacio>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activos.map((t, i) => (
              <Aparecer key={t.id_ticket} retraso={Math.min(i, 6) * 0.05} className="h-full">
                <TicketTarjeta t={t} onVerQr={setQrAbierto} onTransferir={setTransfiriendo} />
              </Aparecer>
            ))}
          </div>
          {historicos.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 font-semibold text-zinc-600 dark:text-zinc-400">Historial</h2>
              <div className="card divide-y divide-zinc-100 dark:divide-white/5 p-0!">
                {historicos.map((t) => (
                  <div key={t.id_ticket} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span>{t.evento} · {t.nombre_tipo}{t.asiento && ` · ${t.asiento}`}</span>
                    <Badge estado={t.estado} />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'compras' && (
        <div className="card overflow-x-auto p-0!">
          <table className="tabla">
            <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
              <tr><th className="p-3">#</th><th className="p-3">Evento</th><th className="p-3">Fecha</th><th className="p-3">Tickets</th><th className="p-3">Total</th><th className="p-3">Pago</th><th className="p-3">Estado</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {ventas.map((v) => (
                <tr key={v.id_venta}>
                  <td className="p-3">{v.id_venta}</td>
                  <td className="p-3">{v.evento}<div className="text-xs text-zinc-400 dark:text-zinc-500">{v.tenant}{v.vendedor && ` · vendedor: ${v.vendedor}`}</div></td>
                  <td className="p-3">{fecha(v.fecha_venta)}</td>
                  <td className="p-3">{v.cantidad_tickets}</td>
                  <td className="p-3">{moneda(v.monto_total)}</td>
                  <td className="p-3 capitalize">{v.metodo_pago}</td>
                  <td className="p-3"><Badge estado={v.estado} /></td>
                  <td className="space-x-2 whitespace-nowrap p-3 text-right">
                    {v.estado === 'pendiente' && <Link className="btn-primary py-1!" to={`/ventas/${v.id_venta}/pagar`}>Pagar</Link>}
                    {v.estado === 'pagado' && (
                      <>
                        <Link className="btn-secondary py-1!" to={`/entrada/${v.token_acceso}`}>Ver entradas</Link>
                        <button
                          className="btn-secondary py-1!"
                          title={v.whatsapp_contacto ? `Enviar a ${v.whatsapp_contacto}` : ''}
                          onClick={() => ejecutar(() => ventasApi.reenviarWhatsapp(v.id_venta), `Entradas reenviadas a ${v.whatsapp_contacto}`)}
                        >
                          <PaperPlaneTilt size={14} weight="bold" aria-hidden /> Reenviar
                        </button>
                      </>
                    )}
                    {['pendiente', 'pagado'].includes(v.estado) && (
                      <button className="btn-secondary py-1!" onClick={() => cancelarVenta(v)}>{v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar'}</button>
                    )}
                  </td>
                </tr>
              ))}
              {ventas.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-zinc-400 dark:text-zinc-500">Sin compras</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'transferencias' && (
        <div className="card divide-y divide-zinc-100 dark:divide-white/5 p-0!">
          {transferencias.map((tr) => (
            <div key={tr.id_transferencia} className="flex flex-col justify-between gap-1 px-5 py-3 text-sm sm:flex-row">
              <span>
                {tr.direccion === 'enviada' ? <><ArrowUpRight size={14} weight="bold" className="mr-1 inline text-indigo-500" aria-hidden />Enviaste</> : <><ArrowDownLeft size={14} weight="bold" className="mr-1 inline text-emerald-500" aria-hidden />Recibiste</>} <b>{tr.nombre_tipo}</b> de {tr.evento}{' '}
                {tr.direccion === 'enviada' ? `a ${tr.email_destino}` : `de ${tr.email_origen}`}
              </span>
              <span className="text-zinc-400 dark:text-zinc-500">{fecha(tr.fecha_transferencia)}</span>
            </div>
          ))}
          {transferencias.length === 0 && <p className="p-6 text-center text-zinc-400 dark:text-zinc-500">Sin transferencias</p>}
        </div>
      )}

      {tab === 'espera' && (
        <div className="card divide-y divide-zinc-100 dark:divide-white/5 p-0!">
          {espera.map((e) => (
            <div key={e.id_espera} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span>
                {e.evento} · {e.nombre_tipo} · {e.cantidad} ticket(s){' '}
                {e.estado === 'notificado' && <Link to={`/eventos/${e.id_evento}`} className="ml-2 text-indigo-600 dark:text-indigo-400 underline">¡Hay stock! Comprar</Link>}
              </span>
              <span className="flex items-center gap-2">
                <Badge estado={e.estado} />
                <button className="text-rose-600 dark:text-rose-400 hover:underline" onClick={() => ejecutar(() => eventosApi.salirEspera(e.id_espera), 'Saliste de la lista de espera')}>Salir</button>
              </span>
            </div>
          ))}
          {espera.length === 0 && <p className="p-6 text-center text-zinc-400 dark:text-zinc-500">No estás en ninguna lista de espera</p>}
        </div>
      )}

      {qrAbierto && (
        <Modal titulo={`${qrAbierto.evento} · ${qrAbierto.nombre_tipo}`} onClose={() => setQrAbierto(null)}>
          <TicketImagen idTicket={qrAbierto.id_ticket} />
          <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">Presentá este código en el acceso{qrAbierto.asiento && ` · Asiento ${qrAbierto.asiento}`}</p>
        </Modal>
      )}

      {transfiriendo && (
        <Modal titulo="Transferir ticket" onClose={() => setTransfiriendo(null)}>
          <form onSubmit={transferir} className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {transfiriendo.evento} · {transfiriendo.nombre_tipo}. El destinatario debe tener cuenta. Tu QR actual quedará invalidado y se generará uno nuevo para el destinatario.
            </p>
            <input className="input" type="email" placeholder="email@destinatario.com" value={emailDestino} onChange={(e) => setEmailDestino(e.target.value)} required />
            <button className="btn-primary w-full">Confirmar transferencia</button>
          </form>
        </Modal>
      )}
    </>
  );
}
