import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { mensajeError, publicoApi, urlUpload } from '../api/client';
import { Alerta, Badge, Spinner } from '../components/ui';
import { fecha } from '../utils/format';
import { DownloadSimple } from '@phosphor-icons/react';

/**
 * /entrada/:token — página pública (link enviado por WhatsApp).
 * Cada entrada válida se muestra como imagen compuesta por el servidor: imagen del evento + QR.
 */
export default function Entrada() {
  const { token } = useParams();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  const [params] = useSearchParams();
  const paymentId = params.get('payment_id') || params.get('collection_id');

  useEffect(() => {
    // Si vuelve de MercadoPago, primero se verifica el pago con el servidor (no se confía en la URL)
    const verificar = paymentId ? publicoApi.verificarPago(token, paymentId).catch(() => null) : Promise.resolve();
    verificar.then(() => publicoApi.entradas(token)).then(setDatos).catch((e) => setError(mensajeError(e)));
  }, [token, paymentId]);

  if (error) return <Alerta>{error}</Alerta>;
  if (!datos) return <Spinner />;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card overflow-hidden text-center">
        {datos.imagen_evento && <img src={urlUpload(datos.imagen_evento)} alt="" className="-mx-5 -mt-5 mb-4 h-40 w-[calc(100%+2.5rem)] max-w-none object-cover" />}
        <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{datos.tenant}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{datos.evento}</h1>
        <p className="text-zinc-500 dark:text-zinc-400">{fecha(datos.fecha_evento)}</p>
        <p className="mt-2 text-sm">Titular: <b>{datos.comprador}</b></p>
      </div>

      {datos.estado === 'pendiente' && (datos.metodo_pago === 'efectivo'
        ? <Alerta tipo="info">Reserva pendiente de pago en efectivo. Abonala al vendedor o en el complejo{datos.expira_en ? ` antes del ${fecha(datos.expira_en)}` : ''}: las entradas se habilitan cuando el complejo confirme el pago.</Alerta>
        : <Alerta tipo="info">La compra está pendiente de pago. Las entradas se habilitan cuando se acredite.</Alerta>)}
      {['cancelado', 'reembolsado'].includes(datos.estado) && <Alerta>Esta compra fue {datos.estado}.</Alerta>}

      {datos.tickets.map((t, i) => (
        <div key={t.id_ticket} className="card space-y-3 text-center">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Entrada {i + 1} de {datos.tickets.length} · {t.nombre_tipo}{t.asiento && ` · ${t.asiento}`}</span>
            <Badge estado={t.estado} />
          </div>
          {t.imagen_url ? (
            <>
              <img src={t.imagen_url} alt={`Entrada ${i + 1} con código QR`} className="mx-auto w-full max-w-sm rounded-lg border border-zinc-200 dark:border-white/10" />
              <a className="btn-secondary w-full" href={t.imagen_url} download={`entrada-${t.id_ticket}.png`}><DownloadSimple size={16} weight="bold" aria-hidden /> Descargar entrada</a>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t.estado === 'usado' ? 'Esta entrada ya fue utilizada.' : 'QR no disponible.'}</p>
          )}
        </div>
      ))}
      {datos.tickets.length === 0 && <p className="text-center text-zinc-500 dark:text-zinc-400">No hay entradas activas en esta compra (pudieron ser transferidas).</p>}
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">Presentá el QR en el ingreso. No compartas este link: quien lo tenga puede usar tus entradas.</p>
    </div>
  );
}
