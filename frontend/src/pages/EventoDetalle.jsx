import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Armchair, Bank, Bell, CalendarBlank, CreditCard, Handshake, MapPin, Minus, Plus, ShieldCheck, Ticket, UsersThree, Wallet } from '@phosphor-icons/react';
import { useNavigate, useParams } from 'react-router-dom';
import { eventosApi, mensajeError, urlUpload, ventasApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTickets } from '../context/TicketsContext';
import { useTenant } from '../context/TenantContext';
import WhatsappInput from '../components/WhatsappInput';
import { Alerta, Badge, Spinner } from '../components/ui';
import SeatMap from '../components/SeatMap';
import { fecha, importe, moneda } from '../utils/format';

const EASE_OUT = [0.23, 1, 0.32, 1];

const METODOS = {
  mercadopago: { icono: Wallet, titulo: 'MercadoPago', detalle: 'Tarjeta, débito o dinero en cuenta' },
  transferencia: { icono: Bank, titulo: 'Transferencia bancaria', detalle: 'Se acredita al confirmar el organizador' },
  tarjeta: { icono: CreditCard, titulo: 'Tarjeta', detalle: 'Modo de prueba' },
  billetera: { icono: Wallet, titulo: 'Billetera', detalle: 'Modo de prueba' },
};

export default function EventoDetalle() {
  const { id } = useParams();
  const reducir = useReducedMotion();
  const navigate = useNavigate();
  const { usuario, esComprador } = useAuth();
  const { referido, setReferido } = useTenant();
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappOk, setWhatsappOk] = useState(null);
  const { tickets, refrescar } = useTickets();
  const [evento, setEvento] = useState(null);
  const [cantidades, setCantidades] = useState({});
  const [asientosSel, setAsientosSel] = useState([]);
  const [metodo, setMetodo] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = () =>
    eventosApi
      .detalle(id)
      .then((ev) => {
        setEvento(ev);
        // Primer método que ofrece el complejo (MercadoPago si está configurado)
        setMetodo((m) => (ev.metodos_pago.includes(m) ? m : ev.metodos_pago[0]));
      })
      .catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, [id]);
  useEffect(() => { if (usuario?.whatsapp) setWhatsapp(usuario.whatsapp); }, [usuario]);

  const ahora = new Date();
  const enVenta = (t) =>
    (!t.venta_desde || new Date(t.venta_desde) <= ahora) && (!t.venta_hasta || new Date(t.venta_hasta) >= ahora);

  // Con seating plan la cantidad por tipo sale de los asientos elegidos
  const cantidadesFinales = useMemo(() => {
    if (!evento?.tiene_seating) return cantidades;
    const r = {};
    for (const idA of asientosSel) {
      const a = evento.asientos.find((x) => x.id_asiento === idA);
      r[a.id_tipo] = (r[a.id_tipo] || 0) + 1;
    }
    return r;
  }, [evento, cantidades, asientosSel]);

  if (error && !evento) return <Alerta>{error}</Alerta>;
  if (!evento) return <Spinner />;

  const yaTengo = tickets.filter((t) => t.id_evento === evento.id_evento && ['pendiente', 'valido', 'usado'].includes(t.estado)).length;
  const limite = evento.limite_por_persona;
  const disponiblePorLimite = limite ? Math.max(0, limite - yaTengo) : Infinity;
  const totalCantidad = Object.values(cantidadesFinales).reduce((a, b) => a + b, 0);
  const total = evento.tipos.reduce((s, t) => s + (cantidadesFinales[t.id_tipo] || 0) * Number(t.precio), 0);
  const superaLimite = totalCantidad > disponiblePorLimite;
  const vendible = evento.estado === 'publicado';
  // El referido aplica si el link es de este complejo y (si es de un evento) de este evento
  const referidoValido =
    referido && referido.id_tenant === evento.id_tenant && (!referido.id_evento || referido.id_evento === evento.id_evento) ? referido : null;

  const cambiarCantidad = (t, delta) => {
    const actual = cantidades[t.id_tipo] || 0;
    const nueva = Math.max(0, Math.min(actual + delta, t.stock_disponible));
    if (delta > 0 && totalCantidad >= disponiblePorLimite) return setError(`Límite de ${limite} tickets por persona alcanzado`);
    setError('');
    setCantidades({ ...cantidades, [t.id_tipo]: nueva });
  };

  const toggleAsiento = (a) => {
    setError('');
    if (asientosSel.includes(a.id_asiento)) return setAsientosSel(asientosSel.filter((x) => x !== a.id_asiento));
    if (asientosSel.length >= disponiblePorLimite) return setError(`Límite de ${limite} tickets por persona alcanzado`);
    setAsientosSel([...asientosSel, a.id_asiento]);
  };

  const comprar = async () => {
    if (!usuario) return navigate('/login', { state: { volver: `/eventos/${id}` } });
    if (!whatsappOk) return setError('Ingresá un número de WhatsApp válido para recibir tus entradas');
    setEnviando(true);
    setError('');
    try {
      const items = Object.entries(cantidadesFinales)
        .filter(([, c]) => c > 0)
        .map(([id_tipo, cantidad]) => ({
          id_tipo: Number(id_tipo),
          cantidad,
          asientos: evento.tiene_seating
            ? asientosSel.filter((idA) => evento.asientos.find((a) => a.id_asiento === idA).id_tipo === Number(id_tipo))
            : undefined,
        }));
      const { venta } = await ventasApi.comprar({
        id_evento: evento.id_evento, metodo_pago: metodo, items, whatsapp, codigo_link: referidoValido?.codigo,
      });
      await refrescar();
      navigate(venta.estado === 'pagado' ? '/mi-cuenta' : `/ventas/${venta.id_venta}/pagar`, {
        state: venta.estado === 'pagado' ? { mensaje: `¡Listo! Te enviamos las entradas por WhatsApp a ${venta.whatsapp_contacto}.` } : undefined,
      });
    } catch (e) {
      const msg = mensajeError(e);
      if (/link de venta/i.test(msg)) setReferido(null);
      setError(msg);
      cargar();
    } finally {
      setEnviando(false);
    }
  };

  const unirseEspera = async (t) => {
    if (!usuario) return navigate('/login');
    try {
      const r = await eventosApi.unirseEspera(t.id_tipo, 1);
      setAviso(r.mensaje);
      refrescar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  return (
    <>
      {/* Portada: imagen del evento a todo el ancho con el título encima */}
      <header className="relative -mx-4 -mt-8 mb-8 overflow-hidden sm:mx-0 sm:mt-0 sm:rounded-3xl">
        {evento.imagen_evento ? (
          <img src={urlUpload(evento.imagen_evento)} alt="" className="h-72 w-full object-cover sm:h-96" />
        ) : (
          <div className="h-72 w-full bg-[radial-gradient(ellipse_at_70%_20%,rgb(99_102_241/0.6),transparent_60%),linear-gradient(135deg,#18181b,#312e81)] sm:h-96" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-zinc-950/90 via-zinc-950/40 to-transparent" />
        <motion.div
          initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(16px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)' }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="absolute inset-x-0 bottom-0 p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-indigo-200">{evento.tenant}</span>
            <Badge estado={evento.estado} />
          </div>
          <h1 className="mt-2 max-w-[22ch] text-3xl font-semibold tracking-tight text-white sm:text-5xl">{evento.nombre}</h1>
        </motion.div>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <section className="min-w-0 space-y-8 lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              [CalendarBlank, 'Fecha', fecha(evento.fecha)],
              [MapPin, 'Lugar', evento.lugar],
              [UsersThree, 'Límite', limite ? `${limite} por persona${usuario ? ` (tenés ${yaTengo})` : ''}` : 'Sin límite por persona'],
              [evento.tiene_seating ? Armchair : Ticket, 'Ubicación', evento.tiene_seating ? 'Numerada, elegís tu butaca' : 'Entrada general'],
            ].map(([Icono, titulo, valor]) => (
              <div key={titulo} className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <Icono size={20} weight="duotone" aria-hidden />
                </span>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">{titulo}</dt>
                  <dd className="font-medium">{valor}</dd>
                </div>
              </div>
            ))}
          </dl>
          {evento.descripcion && <p className="max-w-[65ch] leading-relaxed text-zinc-700 dark:text-zinc-300">{evento.descripcion}</p>}

          <div>
            <h2 className="mb-4 text-xl font-semibold tracking-tight">Entradas</h2>
            <div className="space-y-3">
              {evento.tipos.map((t) => {
                const agotado = t.stock_disponible === 0;
                const activoVenta = enVenta(t);
                const elegidas = cantidadesFinales[t.id_tipo] || 0;
                return (
                  <div
                    key={t.id_tipo}
                    className={`flex flex-col gap-4 rounded-2xl p-5 ring-1 transition-[box-shadow,background-color] duration-200 sm:flex-row sm:items-center sm:justify-between ${
                      elegidas
                        ? 'bg-indigo-50/60 ring-indigo-500/40 dark:bg-indigo-500/10 dark:ring-indigo-400/40'
                        : 'bg-white ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/10'
                    }`}
                  >
                    <div>
                      <p className="flex flex-wrap items-baseline gap-x-3 font-semibold">
                        {t.nombre_tipo}
                        <span className="tabular-nums text-indigo-700 dark:text-indigo-300">{moneda(t.precio)}</span>
                      </p>
                      {t.condiciones && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{t.condiciones}</p>}
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                        {agotado ? 'Agotado' : t.stock_disponible <= 20 ? `Quedan ${t.stock_disponible}` : `${t.stock_disponible} disponibles`}
                        {t.venta_hasta && ` · venta hasta ${fecha(t.venta_hasta)}`}
                      </p>
                    </div>
                    {agotado ? (
                      <button className="btn-secondary" onClick={() => unirseEspera(t)}><Bell size={16} weight="bold" aria-hidden />Avisarme si se libera</button>
                    ) : !activoVenta ? (
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">Fuera del período de venta</span>
                    ) : evento.tiene_seating ? (
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">{elegidas ? `${elegidas} elegida${elegidas > 1 ? 's' : ''} en el plano` : 'Elegí en el plano'}</span>
                    ) : (
                      <div className="flex items-center gap-1 self-start rounded-full bg-white p-1 ring-1 ring-zinc-900/10 sm:self-auto dark:bg-zinc-800 dark:ring-white/10">
                        <button
                          className="grid h-9 w-9 place-items-center rounded-full transition-[transform,background-color] duration-150 ease-out hover:bg-zinc-100 active:scale-[0.92] disabled:opacity-40 dark:hover:bg-white/10"
                          disabled={!vendible || !elegidas}
                          onClick={() => cambiarCantidad(t, -1)}
                          aria-label={`Quitar una entrada ${t.nombre_tipo}`}
                        >
                          <Minus size={16} weight="bold" aria-hidden />
                        </button>
                        <span className="relative grid w-8 place-items-center overflow-hidden text-center font-semibold tabular-nums" aria-live="polite">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span
                              key={elegidas}
                              initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }}
                              animate={{ opacity: 1, transform: 'translateY(0px)' }}
                              exit={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-8px)' }}
                              transition={{ duration: 0.15, ease: EASE_OUT }}
                            >
                              {elegidas}
                            </motion.span>
                          </AnimatePresence>
                        </span>
                        <button
                          className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-white transition-[transform,background-color] duration-150 ease-out hover:bg-indigo-500 active:scale-[0.92] disabled:opacity-40"
                          disabled={!vendible || elegidas >= t.stock_disponible}
                          onClick={() => cambiarCantidad(t, 1)}
                          aria-label={`Agregar una entrada ${t.nombre_tipo}`}
                        >
                          <Plus size={16} weight="bold" aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {!!evento.tiene_seating && (
            <div className="card">
              <h2 className="mb-4 text-xl font-semibold tracking-tight">Elegí tu ubicación</h2>
              <SeatMap
                asientos={evento.asientos}
                seleccion={asientosSel}
                onToggle={toggleAsiento}
                tiposPermitidos={vendible ? evento.tipos.filter((t) => t.stock_disponible > 0 && enVenta(t)).map((t) => t.id_tipo) : []}
              />
            </div>
          )}
        </section>

        <aside id="resumen" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
          <div className="card space-y-4 p-6">
            <h2 className="text-lg font-semibold">Tu compra</h2>
            {referidoValido && (
              <p className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">
                <Handshake size={18} weight="duotone" aria-hidden /> Comprás con <b>{referidoValido.vendedor}</b>
              </p>
            )}
            <Alerta onClose={() => setError('')}>{error}</Alerta>
            <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
            {evento.tipos.filter((t) => cantidadesFinales[t.id_tipo]).map((t) => (
              <div key={t.id_tipo} className="flex justify-between text-sm">
                <span>{cantidadesFinales[t.id_tipo]} × {t.nombre_tipo}</span>
                <span className="tabular-nums">{moneda(cantidadesFinales[t.id_tipo] * t.precio)}</span>
              </div>
            ))}
            {totalCantidad === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">Todavía no elegiste entradas.</p>}
            <div className="flex items-baseline justify-between border-t border-zinc-100 pt-4 dark:border-white/10">
              <span className="font-medium">Total</span>
              <motion.span
                key={total}
                initial={reducir ? false : { opacity: 0.4, transform: 'translateY(4px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="text-2xl font-semibold tabular-nums tracking-tight"
              >
                {totalCantidad ? moneda(total) : importe(0)}
              </motion.span>
            </div>

            {total > 0 && (
              <fieldset>
                <legend className="label">Método de pago</legend>
                <div className="grid gap-2">
                  {evento.metodos_pago.map((valor) => {
                    const { icono: Icono, titulo, detalle } = METODOS[valor];
                    const activo = metodo === valor;
                    return (
                      <label
                        key={valor}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-500 ${
                          activo ? 'bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'ring-zinc-900/10 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5'
                        }`}
                      >
                        <input type="radio" name="metodo" value={valor} checked={activo} onChange={() => setMetodo(valor)} className="sr-only" />
                        <Icono size={22} weight="duotone" className={activo ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500'} aria-hidden />
                        <span className="flex-1">
                          <span className="block font-medium">{titulo}</span>
                          {detalle && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{detalle}</span>}
                        </span>
                        <span className={`grid h-4 w-4 place-items-center rounded-full ring-1 ${activo ? 'bg-indigo-600 ring-indigo-600' : 'ring-zinc-300 dark:ring-white/20'}`}>
                          {activo && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {usuario && esComprador && totalCantidad > 0 && (
              <WhatsappInput label="WhatsApp para recibir las entradas" value={whatsapp} onChange={setWhatsapp} onValidez={setWhatsappOk} />
            )}
            {usuario && !esComprador && <p className="text-sm text-amber-700 dark:text-amber-300">Ingresá con una cuenta de comprador para comprar.</p>}
            {superaLimite && <p className="text-sm text-rose-600 dark:text-rose-400">Supera el límite de {limite} entradas por persona.</p>}
            <button className="btn-primary w-full py-3!" disabled={!vendible || totalCantidad === 0 || superaLimite || enviando || (usuario && (!esComprador || !whatsappOk))} onClick={comprar}>
              {enviando ? 'Procesando…' : usuario ? 'Comprar' : 'Ingresá para comprar'}
            </button>
            {!vendible && <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">Este evento no está a la venta.</p>}
            <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
              <ShieldCheck size={14} weight="bold" aria-hidden /> Tus entradas llegan por WhatsApp con QR único
            </p>
          </div>
        </aside>
      </div>

      {/* Móvil: barra fija con el total que lleva al resumen */}
      <AnimatePresence>
        {totalCantidad > 0 && (
          <motion.div
            initial={reducir ? { opacity: 0 } : { transform: 'translateY(110%)' }}
            animate={reducir ? { opacity: 1 } : { transform: 'translateY(0%)' }}
            exit={reducir ? { opacity: 0 } : { transform: 'translateY(110%)', transition: { duration: 0.18 } }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-900/10 bg-white/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden dark:border-white/10 dark:bg-zinc-950/90"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{totalCantidad} entrada{totalCantidad > 1 ? 's' : ''}</p>
                <p className="text-lg font-semibold tabular-nums">{moneda(total)}</p>
              </div>
              <a href="#resumen" className="btn-primary">Continuar</a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
