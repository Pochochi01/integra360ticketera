import { useEffect, useState } from 'react';
import { mensajeError, vendedoresApi, ventasApi } from '../../api/client';
import { Alerta, Badge, Spinner, useConfirmar } from '../../components/ui';
import { fecha, importe, moneda } from '../../utils/format';
import { Handshake, Money, PaperPlaneTilt, WhatsappLogo } from '@phosphor-icons/react';

export default function AdminVentas() {
  const confirmar = useConfirmar();
  const [ventas, setVentas] = useState(null);
  const [efectivo, setEfectivo] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [filtros, setFiltros] = useState({ estado: '', id_vendedor: '' });
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = () =>
    Promise.all([
      ventasApi.listar({ estado: filtros.estado || undefined, id_vendedor: filtros.id_vendedor || undefined }).then(setVentas),
      ventasApi.listar({ metodo_pago: 'efectivo', estado: 'pendiente' }).then(setEfectivo),
    ]).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, [filtros]);
  useEffect(() => { vendedoresApi.listar().then(setVendedores).catch(() => {}); }, []);

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

  if (!ventas) return <Spinner />;
  const recaudado = ventas.filter((v) => v.estado === 'pagado').reduce((s, v) => s + Number(v.monto_total), 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{ventas.length} ventas · recaudado {importe(recaudado)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto!" value={filtros.id_vendedor} onChange={(e) => setFiltros({ ...filtros, id_vendedor: e.target.value })}>
            <option value="">Todos los canales</option>
            <option value="ninguno">Venta directa (sin vendedor)</option>
            {vendedores.map((v) => <option key={v.id_vendedor} value={v.id_vendedor}>{v.apellido}, {v.nombre}</option>)}
          </select>
          <select className="input w-auto!" value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
            <option value="">Todos los estados</option>
            {['pendiente', 'pagado', 'cancelado', 'reembolsado'].map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

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
                  <div className="text-xs text-zinc-400 dark:text-zinc-500">{v.whatsapp_contacto || v.email_comprador}{v.whatsapp_enviado_en && <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><WhatsappLogo size={12} weight="fill" aria-hidden />enviado</span>}</div>
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
                <td className="space-x-2 whitespace-nowrap p-3 text-right">
                  {v.estado === 'pendiente' && v.metodo_pago !== 'mercadopago' && (
                    <button className="btn-primary py-1!" onClick={() => accion(() => ventasApi.confirmarPago(v.id_venta), 'Pago confirmado y entradas enviadas')}>{v.metodo_pago === 'efectivo' ? 'Validar cobro' : 'Confirmar pago'}</button>
                  )}
                  {v.estado === 'pagado' && v.whatsapp_contacto && (
                    <button className="btn-secondary py-1!" onClick={() => accion(() => ventasApi.reenviarWhatsapp(v.id_venta), `Reenviado a ${v.whatsapp_contacto}`)} aria-label={`Reenviar entradas por WhatsApp a ${v.whatsapp_contacto}`} title="Reenviar por WhatsApp"><PaperPlaneTilt size={16} weight="bold" aria-hidden /></button>
                  )}
                  {['pendiente', 'pagado'].includes(v.estado) && (
                    <button className="btn-secondary py-1!" onClick={async () => (await confirmar(v.estado === 'pagado' ? `Se devuelve el dinero al comprador y se liberan sus entradas.` : `Se liberan las entradas reservadas.`, { titulo: `${v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar'} venta #${v.id_venta}`, aceptar: v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar venta', peligro: true })) && accion(() => ventasApi.cancelar(v.id_venta))}>
                      {v.estado === 'pagado' ? 'Reembolsar' : 'Cancelar'}
                    </button>
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
