import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { mensajeError, ventasApi } from '../api/client';
import { useTickets } from '../context/TicketsContext';
import { Alerta, Spinner } from '../components/ui';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowCounterClockwise, CheckCircle, HourglassMedium, Timer, XCircle } from '@phosphor-icons/react';

/**
 * /ventas/:id/resultado — retorno desde MercadoPago (back_urls).
 * Los parámetros de la URL no se consideran prueba de pago: el backend consulta el pago a MercadoPago.
 * Si queda pendiente, se reconsulta unas veces (el webhook puede tardar unos segundos).
 */
export default function PagoResultado() {
  const reducir = useReducedMotion();
  const { id } = useParams();
  const [params] = useSearchParams();
  const { refrescar } = useTickets();
  const [venta, setVenta] = useState(null);
  const [error, setError] = useState('');
  const paymentId = params.get('payment_id') || params.get('collection_id');
  const estadoMp = params.get('status') || params.get('collection_status');

  useEffect(() => {
    let intentos = 0;
    let timer;
    const consultar = async () => {
      try {
        const r = await ventasApi.verificarPago(id, paymentId || undefined);
        setVenta(r.venta);
        if (r.venta.estado === 'pendiente' && estadoMp !== 'rejected' && ++intentos < 6) timer = setTimeout(consultar, 3000);
        else refrescar();
      } catch (e) {
        setError(mensajeError(e));
      }
    };
    consultar();
    return () => clearTimeout(timer);
  }, [id, paymentId]);

  if (error) return <Alerta>{error}</Alerta>;
  if (!venta) return <Spinner />;

  const vistas = {
    pagado: { icono: CheckCircle, color: 'text-emerald-600 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/15', titulo: 'Pago aprobado', texto: `Te enviamos las entradas por WhatsApp${venta.whatsapp_contacto ? ` a ${venta.whatsapp_contacto}` : ''}.` },
    pendiente: estadoMp === 'rejected'
      ? { icono: XCircle, color: 'text-rose-600 bg-rose-100 dark:text-rose-300 dark:bg-rose-500/15', titulo: 'El pago fue rechazado', texto: 'Podés intentar de nuevo con otro medio de pago.' }
      : { icono: HourglassMedium, color: 'text-amber-600 bg-amber-100 dark:text-amber-300 dark:bg-amber-500/15', titulo: 'Pago en proceso', texto: 'MercadoPago todavía está procesando el pago. Te avisaremos por WhatsApp cuando se acredite.' },
    cancelado: { icono: Timer, color: 'text-zinc-600 bg-zinc-100 dark:text-zinc-300 dark:bg-white/10', titulo: 'La reserva expiró', texto: 'Si el pago se acreditó igual, se reintegra automáticamente.' },
    reembolsado: { icono: ArrowCounterClockwise, color: 'text-sky-600 bg-sky-100 dark:text-sky-300 dark:bg-sky-500/15', titulo: 'Compra reembolsada', texto: 'El dinero vuelve al mismo medio de pago.' },
  };
  const v = vistas[venta.estado];
  const Icono = v.icono;

  return (
    <div className="card mx-auto mt-6 max-w-md space-y-3 p-8 text-center">
      <motion.div
        key={venta.estado}
        initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.6)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        transition={reducir ? { duration: 0.2 } : { type: 'spring', duration: 0.5, bounce: 0.35 }}
        className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${v.color}`}
      >
        <Icono size={36} weight="fill" aria-hidden />
      </motion.div>
      <h1 className="pt-2 text-2xl font-semibold tracking-tight">{v.titulo}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{v.texto}</p>
      <p className="text-sm text-zinc-400 dark:text-zinc-500">Compra #{venta.id_venta} · {venta.evento}</p>
      <div className="flex justify-center gap-2 pt-2">
        {venta.estado === 'pagado' && <Link className="btn-primary" to={`/entrada/${venta.token_acceso}`}>Ver mis entradas</Link>}
        {venta.estado === 'pendiente' && <Link className="btn-primary" to={`/ventas/${venta.id_venta}/pagar`}>Reintentar pago</Link>}
        <Link className="btn-secondary" to="/mi-cuenta">Mi cuenta</Link>
      </div>
    </div>
  );
}
