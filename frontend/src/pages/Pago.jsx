import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { mensajeError, ventasApi } from '../api/client';
import { useTickets } from '../context/TicketsContext';
import { Alerta, Badge, Spinner, useConfirmar } from '../components/ui';
import { moneda } from '../utils/format';

export default function Pago() {
  const confirmar = useConfirmar();
  const { id } = useParams();
  const navigate = useNavigate();
  const { refrescar } = useTickets();
  const [venta, setVenta] = useState(null);
  const [datos, setDatos] = useState({ numero_tarjeta: '', titular: '', vencimiento: '', cvv: '', alias_billetera: '' });
  const [error, setError] = useState('');
  const [instrucciones, setInstrucciones] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { ventasApi.detalle(id).then(setVenta).catch((e) => setError(mensajeError(e))); }, [id]);

  if (error && !venta) return <Alerta>{error}</Alerta>;
  if (!venta) return <Spinner />;

  const set = (k) => (e) => setDatos({ ...datos, [k]: e.target.value });

  const pagar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      const r = await ventasApi.pagar(id, datos);
      // MercadoPago: se continúa en Checkout Pro y se vuelve a /ventas/:id/resultado
      if (r.pago.estado === 'redirigir') {
        window.location.assign(r.pago.url);
        return;
      }
      await refrescar();
      if (r.pago.estado === 'aprobado') return navigate('/mi-cuenta', { state: { mensaje: `Pago aprobado. Te enviamos las entradas por WhatsApp${r.venta.whatsapp_contacto ? ` a ${r.venta.whatsapp_contacto}` : ''}.` } });
      setInstrucciones(r.pago.instrucciones);
      setVenta({ ...venta, ...r.venta });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async () => {
    if (!(await confirmar('Las entradas reservadas quedan libres para otros compradores.', { titulo: 'Cancelar compra', aceptar: 'Cancelar compra', cancelar: 'Seguir comprando', peligro: true }))) return;
    await ventasApi.cancelar(id);
    await refrescar();
    navigate('/mi-cuenta');
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="card">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Pago de la compra #{venta.id_venta}</h1>
          <Badge estado={venta.estado} />
        </div>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">{venta.evento}</p>
        <ul className="mt-3 space-y-1 text-sm">
          {venta.tickets?.map((t) => (
            <li key={t.id_ticket} className="flex justify-between">
              <span>{t.nombre_tipo}{t.asiento && ` · ${t.asiento}`}</span>
              <span>{moneda(t.precio)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-zinc-100 dark:border-white/5 pt-3 text-lg font-semibold">
          <span>Total</span><span>{moneda(venta.monto_total)}</span>
        </p>
      </div>

      {venta.estado !== 'pendiente' ? (
        <Alerta tipo="info">Esta venta está {venta.estado}. <Link className="underline" to="/mi-cuenta">Ver mis tickets</Link></Alerta>
      ) : instrucciones || venta.referencia_pago && venta.metodo_pago === 'transferencia' ? (
        <div className="card space-y-2 text-sm">
          <h2 className="font-semibold">Datos para la transferencia</h2>
          <p>CBU: <b>{instrucciones?.cbu || '0000003100012345678901'}</b></p>
          <p>Alias: <b>{instrucciones?.alias || 'INTEGRA360.TICKETS'}</b></p>
          <p>Referencia: <b>{venta.referencia_pago}</b></p>
          <p className="text-zinc-500 dark:text-zinc-400">Tus tickets se habilitarán cuando confirmemos la acreditación (hasta 48 h de reserva).</p>
          <Link to="/mi-cuenta" className="btn-secondary mt-2">Ir a mis tickets</Link>
        </div>
      ) : (
        <form onSubmit={pagar} className="card space-y-4">
          <Alerta onClose={() => setError('')}>{error}</Alerta>
          {venta.metodo_pago === 'tarjeta' && (
            <>
              <div>
                <label className="label" htmlFor="campo-pago-numero-de-tarjeta">Número de tarjeta</label>
                <input id="campo-pago-numero-de-tarjeta" className="input" inputMode="numeric" placeholder="4111 1111 1111 1111" value={datos.numero_tarjeta} onChange={set('numero_tarjeta')} required />
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Pasarela simulada: 4111 1111 1111 1111 aprueba · números terminados en 0000 se rechazan.</p>
              </div>
              <div>
                <label className="label" htmlFor="campo-pago-titular">Titular</label>
                <input id="campo-pago-titular" className="input" value={datos.titular} onChange={set('titular')} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label" htmlFor="campo-pago-vencimiento">Vencimiento</label><input id="campo-pago-vencimiento" className="input" placeholder="MM/AA" value={datos.vencimiento} onChange={set('vencimiento')} required /></div>
                <div><label className="label" htmlFor="campo-pago-cvv">CVV</label><input id="campo-pago-cvv" className="input" inputMode="numeric" maxLength={4} value={datos.cvv} onChange={set('cvv')} required /></div>
              </div>
            </>
          )}
          {venta.metodo_pago === 'billetera' && (
            <div>
              <label className="label" htmlFor="campo-pago-alias-o-email-de-tu-billetera">Alias o email de tu billetera</label>
              <input id="campo-pago-alias-o-email-de-tu-billetera" className="input" value={datos.alias_billetera} onChange={set('alias_billetera')} required />
            </div>
          )}
          {venta.metodo_pago === 'mercadopago' && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Vas a continuar en <b>MercadoPago</b> para pagar con tarjeta, débito o dinero en cuenta. Al terminar volvés acá automáticamente.</p>
          )}
          {venta.metodo_pago === 'transferencia' && <p className="text-sm text-zinc-600 dark:text-zinc-400">Generaremos los datos bancarios para que realices la transferencia.</p>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={enviando}>{enviando ? 'Procesando…' : venta.metodo_pago === 'transferencia' ? 'Obtener datos bancarios' : venta.metodo_pago === 'mercadopago' ? `Pagar ${moneda(venta.monto_total)} con MercadoPago` : `Pagar ${moneda(venta.monto_total)}`}</button>
            <button type="button" className="btn-secondary" onClick={cancelar}>Cancelar compra</button>
          </div>
        </form>
      )}
    </div>
  );
}
