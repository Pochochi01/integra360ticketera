import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle, ClockCounterClockwise, CurrencyCircleDollar, DoorOpen, Hourglass, Percent, QrCode, Storefront, Ticket, Trophy, UsersThree, Warning, WarningCircle } from '@phosphor-icons/react';
import { adminApi, eventosApi, mensajeError } from '../../../api/client';
import { useTema } from '../../../context/TemaContext';
import { Alerta, Skeleton, Vacio } from '../../ui';
import { fecha, importe } from '../../../utils/format';
import { Actualizado, ejes, Kpi, Tarjeta, tooltipProps, useConsultaEnVivo } from './comun';

/**
 * Control de ingresos en tiempo real (/admin/porteros): por tipo de entrada, vendidas vs. ingresadas y montos.
 * Datos: GET /api/admin/event/:id/ingresos, refrescado cada 10 s mientras la pestaña está visible.
 *
 * Color (validado con la skill dataviz, scripts/validate_palette.js):
 *  - Tipos de entrada: paleta categórica en orden fijo por tipo (el color sigue al tipo, no a su posición en
 *    un ranking ni a lo que muestre un filtro). Claro y oscuro con sus propios pasos. Desde el 7.º tipo,
 *    «Otros» en gris. Sin verdes/amarillos/rojos: esos son del semáforo.
 *  - Semáforo de uso (verde ≥ 70 %, amarillo 40–69 %, rojo < 40 %): siempre con ícono + texto, nunca sólo color.
 */
const CATEGORICA = {
  claro: ['#4f46e5', '#0d9488', '#c026d3', '#0369a1', '#a16207', '#7c3aed'],
  oscuro: ['#6366f1', '#0f9488', '#c026d3', '#0369a1', '#a16207', '#7c3aed'],
};
const OTROS = '#71717a';
// Barras apiladas: un solo tono (ingresadas oscuro, pendientes claro), separadas por un hueco del color de fondo
const APILADO = { claro: { ingresadas: '#4f46e5', pendientes: '#c7d2fe' }, oscuro: { ingresadas: '#818cf8', pendientes: '#3730a3' } };

export const SEMAFORO = {
  alto: { texto: 'Alto', icono: CheckCircle, clase: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300', barra: 'bg-emerald-500' },
  medio: { texto: 'Medio', icono: Warning, clase: 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300', barra: 'bg-amber-500' },
  bajo: { texto: 'Bajo', icono: WarningCircle, clase: 'bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300', barra: 'bg-rose-500' },
};
const semaforoDe = (uso) => (uso >= 70 ? 'alto' : uso >= 40 ? 'medio' : 'bajo');
const pct = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : 0);
const entero = new Intl.NumberFormat('es-AR');

/**
 * Badge del semáforo: color + ícono + texto (legible sin color, en impresión y con daltonismo).
 * Sin ventas no hay uso que medir: badge neutro en vez de un rojo engañoso.
 */
export function Semaforo({ nivel, uso, vendidas = 1 }) {
  if (!vendidas) return <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">Sin ventas</span>;
  const s = SEMAFORO[nivel];
  const Icono = s.icono;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${s.clase}`}>
      <Icono size={13} weight="fill" aria-hidden /> {uso}% · {s.texto}
    </span>
  );
}

/** Barra de progreso del uso con el color del semáforo (el número va siempre al lado). */
const BarraUso = ({ uso, nivel, etiqueta }) => (
  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" role="meter" aria-valuenow={Math.round(uso)} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
    <div className={`h-full rounded-full transition-[width] duration-500 ${SEMAFORO[nivel].barra}`} style={{ width: `${Math.min(100, uso)}%` }} />
  </div>
);

/** Evento por defecto: el próximo / en curso (desde 12 h antes); si no hay, el más reciente. */
export const eventoPorDefecto = (eventos) => {
  const desde = Date.now() - 12 * 3600 * 1000;
  const proximos = eventos.filter((e) => new Date(String(e.fecha).replace(' ', 'T')).getTime() >= desde && e.estado !== 'cancelado')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return (proximos[0] || [...eventos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0])?.id_evento || '';
};
/** Semáforo de capacidad (lugares libres): verde > 50 %, amarillo 10–50 %, rojo ≤ 10 % o agotado. */
const CAPACIDAD = {
  libre: { texto: 'Con lugar', icono: CheckCircle, clase: SEMAFORO.alto.clase, barra: SEMAFORO.alto.barra },
  ajustada: { texto: 'Se llena', icono: Warning, clase: SEMAFORO.medio.clase, barra: SEMAFORO.medio.barra },
  critica: { texto: 'Casi lleno', icono: WarningCircle, clase: SEMAFORO.bajo.clase, barra: SEMAFORO.bajo.barra },
};
const ORIGENES = { puerta_qr: 'QR de compra', puerta_asistida: 'Boletería' };
const METODOS = { mercadopago: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', cortesia: 'Cortesía' };
const ESTADOS_PAGO = {
  approved: { texto: 'Aprobado', clase: SEMAFORO.alto.clase }, pending: { texto: 'Pendiente', clase: SEMAFORO.medio.clase },
  rejected: { texto: 'Rechazado', clase: SEMAFORO.bajo.clase }, cancelled: { texto: 'Cancelado', clase: 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300' },
  refunded: { texto: 'Reembolsado', clase: 'bg-sky-100 text-sky-800 dark:bg-sky-400/10 dark:text-sky-300' },
};
const hora = (f) => new Date(String(f).replace(' ', 'T')).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

const ESTADOS_EVENTO = [['', 'Todos'], ['publicado', 'Publicados'], ['agotado', 'Agotados'], ['finalizado', 'Finalizados'], ['borrador', 'Borradores']];

export default function ControlIngresos() {
  const { tema } = useTema();
  const modo = tema === 'oscuro' ? 'oscuro' : 'claro';
  const [eventos, setEventos] = useState(null);
  const [filtros, setFiltros] = useState({ fecha: '', estado: '', id_evento: '', id_tipo: '' });
  const [errorEventos, setErrorEventos] = useState('');

  useEffect(() => {
    eventosApi.listarTodos()
      .then((evs) => { setEventos(evs); setFiltros((f) => ({ ...f, id_evento: String(eventoPorDefecto(evs)) })); })
      .catch((e) => setErrorEventos(mensajeError(e)));
  }, []);

  const idEvento = filtros.id_evento ? Number(filtros.id_evento) : null;
  const { datos, error, cargando, actualizar } = useConsultaEnVivo(idEvento ? () => adminApi.ingresosEvento(idEvento) : null, idEvento);

  // Eventos que cumplen fecha + estado (el filtro de evento se acota a esos)
  const eventosFiltrados = useMemo(() => (eventos || []).filter((e) =>
    (!filtros.fecha || String(e.fecha).slice(0, 10) === filtros.fecha) && (!filtros.estado || e.estado === filtros.estado)
  ).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)), [eventos, filtros.fecha, filtros.estado]);

  // Color fijo por tipo (orden de id), calculado sobre TODOS los tipos para que un filtro no los repinte
  const colorDe = useMemo(() => {
    const mapa = new Map();
    (datos?.por_tipo || []).forEach((t, i) => mapa.set(t.id_tipo, i < 6 ? CATEGORICA[modo][i] : OTROS));
    return mapa;
  }, [datos, modo]);

  const tipos = useMemo(() => (datos?.por_tipo || []).filter((t) => (!filtros.id_tipo || t.id_tipo === Number(filtros.id_tipo)) && (t.vendidas > 0 || t.activo)), [datos, filtros.id_tipo]);
  // KPIs de lo filtrado (con «todos» coinciden con los generales del backend)
  const k = useMemo(() => {
    const s = (c) => tipos.reduce((acc, t) => acc + t[c], 0);
    const vendidas = s('vendidas'); const ingresadas = s('ingresadas'); const capacidad = s('capacidad');
    const facturado = s('monto_vendido'); const consumido = s('monto_consumido');
    const uso = pct(ingresadas, vendidas);
    return { vendidas, ingresadas, pendientes: s('pendientes'), facturado, consumido, pendienteMonto: facturado - consumido, uso, nivel: semaforoDe(uso), capacidad, capUsada: pct(ingresadas, capacidad) };
  }, [tipos]);

  const set = (campo) => (e) => {
    const valor = e.target.value;
    setFiltros((f) => {
      const nuevo = { ...f, [campo]: valor, ...(campo === 'id_evento' ? { id_tipo: '' } : {}) };
      // Si fecha/estado dejan afuera el evento elegido, se pasa al primero que cumpla
      if (campo === 'fecha' || campo === 'estado') {
        const visibles = (eventos || []).filter((ev) => (!nuevo.fecha || String(ev.fecha).slice(0, 10) === nuevo.fecha) && (!nuevo.estado || ev.estado === nuevo.estado));
        if (!visibles.some((ev) => String(ev.id_evento) === nuevo.id_evento)) { nuevo.id_evento = String(visibles[0]?.id_evento || ''); nuevo.id_tipo = ''; }
      }
      return nuevo;
    });
  };

  if (errorEventos) return <Alerta>{errorEventos}</Alerta>;
  if (!eventos) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (!eventos.length) return <Vacio icono={DoorOpen} titulo="Todavía no hay eventos">Cuando crees un evento, acá vas a ver los ingresos en vivo.</Vacio>;

  // Donut: los 6 primeros tipos con su color; el resto, «Otros»
  const donut = (() => {
    const conVentas = tipos.filter((t) => t.vendidas > 0);
    const principales = conVentas.filter((t) => colorDe.get(t.id_tipo) !== OTROS);
    const otros = conVentas.filter((t) => colorDe.get(t.id_tipo) === OTROS);
    return [
      ...principales.map((t) => ({ nombre: t.nombre, valor: t.vendidas, color: colorDe.get(t.id_tipo) })),
      ...(otros.length ? [{ nombre: 'Otros', valor: otros.reduce((s, t) => s + t.vendidas, 0), color: OTROS }] : []),
    ];
  })();
  const ranking = [...tipos].filter((t) => t.vendidas > 0).sort((a, b) => b.ingresadas - a.ingresadas || b.uso - a.uso).slice(0, 5);
  const alturaBarras = Math.max(140, tipos.length * 44);
  const evento = datos?.evento;

  return (
    <div className="space-y-5" data-testid="control-ingresos">
      {/* Filtros: una fila encima de los gráficos (se apilan en celular) */}
      <div className="card grid grid-cols-2 gap-3 p-4! md:grid-cols-4" role="search" aria-label="Filtros del control de ingresos">
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="ci-evento">Evento</label>
          <select id="ci-evento" className="input" value={filtros.id_evento} onChange={set('id_evento')}>
            {!eventosFiltrados.length && <option value="">Sin eventos con esos filtros</option>}
            {eventosFiltrados.map((e) => <option key={e.id_evento} value={e.id_evento}>{e.nombre} · {fecha(e.fecha)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ci-fecha">Fecha</label>
          <input id="ci-fecha" type="date" className="input" value={filtros.fecha} onChange={set('fecha')} />
        </div>
        <div>
          <label className="label" htmlFor="ci-estado">Estado</label>
          <select id="ci-estado" className="input" value={filtros.estado} onChange={set('estado')}>
            {ESTADOS_EVENTO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="ci-tipo">Tipo de ticket</label>
          <select id="ci-tipo" className="input" value={filtros.id_tipo} onChange={set('id_tipo')} disabled={!datos}>
            <option value="">Todos los tipos</option>
            {(datos?.por_tipo || []).map((t) => <option key={t.id_tipo} value={t.id_tipo}>{t.nombre}</option>)}
          </select>
        </div>
      </div>

      <Alerta>{error}</Alerta>
      {!idEvento ? (
        <Vacio icono={Ticket} titulo="Elegí un evento">Ningún evento cumple los filtros de fecha y estado.</Vacio>
      ) : !datos ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}<Skeleton className="col-span-2 h-64 lg:col-span-4" /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight">{evento.nombre}</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{fecha(evento.fecha)}{evento.lugar ? ` · ${evento.lugar}` : ''}{datos.generales.ultimo_ingreso ? ` · último ingreso ${fecha(datos.generales.ultimo_ingreso)}` : ''}</p>
            </div>
            <Actualizado en={datos.actualizado_en} cargando={cargando} onActualizar={actualizar} />
          </div>

          {/* Indicador principal: ingreso general con semáforo */}
          <section className="card space-y-3" aria-label="Ingreso general">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Ingreso general{filtros.id_tipo ? ' (tipo filtrado)' : ''}</p>
                <p className="text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">{k.uso}%</p>
              </div>
              <Semaforo nivel={k.nivel} uso={k.uso} vendidas={k.vendidas} />
            </div>
            <BarraUso uso={k.uso} nivel={k.nivel} etiqueta={`${k.uso}% de las entradas vendidas ya ingresó`} />
            <p className="text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
              <b>{entero.format(k.ingresadas)}</b> ingresaron de <b>{entero.format(k.vendidas)}</b> vendidas · faltan <b>{entero.format(k.pendientes)}</b>
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpis-ingresos">
            <Kpi icono={Ticket} titulo="Total vendidas" valor={entero.format(k.vendidas)} detalle={`Capacidad ${entero.format(k.capacidad)}`} />
            <Kpi icono={DoorOpen} tono="emerald" titulo="Total ingresadas" valor={entero.format(k.ingresadas)} detalle={`${k.uso}% de lo vendido`} />
            <Kpi icono={Hourglass} tono="amber" titulo="Total pendientes" valor={entero.format(k.pendientes)} detalle="Vendidas que no ingresaron" />
            <Kpi icono={UsersThree} tono="sky" titulo="Capacidad utilizada" valor={`${k.capUsada}%`} detalle={`${entero.format(k.ingresadas)} de ${entero.format(k.capacidad)} lugares`} />
            <Kpi icono={CurrencyCircleDollar} titulo="Total facturado" valor={importe(k.facturado)} />
            <Kpi icono={CurrencyCircleDollar} tono="emerald" titulo="Total consumido" valor={importe(k.consumido)} detalle="Entradas que ya ingresaron" />
            <Kpi icono={CurrencyCircleDollar} tono="amber" titulo="Total pendiente" valor={importe(k.pendienteMonto)} detalle="Entradas sin ingresar" />
            <Kpi icono={Percent} tono="zinc" titulo="% general de ingreso" valor={`${k.uso}%`}><div className="mt-2"><Semaforo nivel={k.nivel} uso={k.uso} vendidas={k.vendidas} /></div></Kpi>
          </div>

          {/* Puerta: capacidad del lugar, ventas en portería y últimas operaciones (del evento completo) */}
          <div className="grid gap-4 lg:grid-cols-3">
            {(() => {
              const g = datos.generales;
              const c = CAPACIDAD[g.semaforo_capacidad] || CAPACIDAD.libre;
              const Icono = c.icono;
              return (
                <Tarjeta titulo="Control de capacidad" accion={<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${c.clase}`}><Icono size={13} weight="fill" aria-hidden />{c.texto}</span>}>
                  <dl className="grid grid-cols-3 gap-2 text-center" data-testid="capacidad">
                    {[['Capacidad', g.capacidad], ['Ingresados', g.ingresadas], ['Disponibles', g.capacidad_disponible]].map(([n, v]) => (
                      <div key={n} className="rounded-xl bg-zinc-50 px-1 py-2 dark:bg-white/5">
                        <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{n}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{entero.format(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" role="meter" aria-valuenow={Math.round(g.capacidad_utilizada)} aria-valuemin={0} aria-valuemax={100} aria-label={`Ocupación ${g.capacidad_utilizada}%`}>
                    <div className={`h-full rounded-full transition-[width] duration-500 ${c.barra}`} style={{ width: `${Math.min(100, g.capacidad_utilizada)}%` }} />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">Ocupación <b>{g.capacidad_utilizada}%</b> · libre {g.capacidad_disponible_pct}%</p>
                </Tarjeta>
              );
            })()}

            <Tarjeta titulo="Ventas en portería" accion={<Storefront size={18} weight="duotone" className="text-zinc-400" aria-hidden />}>
              <div data-testid="ventas-puerta">
                <p className="text-3xl font-semibold tabular-nums tracking-tight">{entero.format(datos.puerta.tickets)} <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">ticket{datos.puerta.tickets === 1 ? '' : 's'}</span></p>
                <p className="text-xl font-semibold tabular-nums">{importe(datos.puerta.monto)}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{pct(datos.puerta.monto, datos.generales.facturado)}% de la facturación del evento</p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  {Object.entries(ORIGENES).map(([clave, nombre]) => {
                    const o = datos.puerta.por_origen[clave];
                    return (
                      <div key={clave} className="flex items-center justify-between gap-2">
                        <dt className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">{clave === 'puerta_qr' ? <QrCode size={15} weight="duotone" aria-hidden /> : <Storefront size={15} weight="duotone" aria-hidden />}{nombre}</dt>
                        <dd className="tabular-nums">{entero.format(o.tickets)} · {importe(o.monto)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </Tarjeta>

            <Tarjeta titulo="Últimas operaciones" accion={<ClockCounterClockwise size={18} weight="duotone" className="text-zinc-400" aria-hidden />}>
              {datos.ultimas_operaciones.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Todavía no hay operaciones.</p>
              ) : (
                <ul className="-my-1 max-h-64 divide-y divide-zinc-100 overflow-y-auto overscroll-contain dark:divide-white/5" data-testid="ultimas-operaciones">
                  {datos.ultimas_operaciones.map((o) => (
                    <li key={o.id_venta} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-11 shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{hora(o.fecha)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{o.comprador}{o.tipos ? ` · ${o.tipos}` : ''}</span>
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{o.cantidad} entrada{o.cantidad === 1 ? '' : 's'} · {METODOS[o.metodo_pago] || o.metodo_pago}{o.origen ? ` · ${ORIGENES[o.origen]}` : ''}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${(ESTADOS_PAGO[o.estado_pago] || ESTADOS_PAGO.pending).clase}`}>{(ESTADOS_PAGO[o.estado_pago] || ESTADOS_PAGO.pending).texto}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>
          </div>

          {k.vendidas === 0 ? (
            <Vacio icono={Ticket} titulo="Todavía no hay entradas vendidas">Cuando se confirmen ventas, acá vas a ver los ingresos por tipo.</Vacio>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Tarjeta titulo="Distribución por tipo de entrada (vendidas)">
                  <div className="grid items-center gap-4 sm:grid-cols-2">
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donut} dataKey="valor" nameKey="nombre" innerRadius="58%" outerRadius="92%" paddingAngle={donut.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                            {donut.map((d) => <Cell key={d.nombre} fill={d.color} />)}
                          </Pie>
                          <Tooltip {...tooltipProps} formatter={(v, n) => [`${entero.format(v)} entradas (${pct(v, k.vendidas)}%)`, n]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Leyenda con valores: la identidad nunca depende sólo del color */}
                    <ul className="space-y-1.5 text-sm">
                      {donut.map((d) => (
                        <li key={d.nombre} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} aria-hidden /><span className="truncate">{d.nombre}</span></span>
                          <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{entero.format(d.valor)} · {pct(d.valor, k.vendidas)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Tarjeta>

                <Tarjeta titulo="Ingresadas por tipo">
                  <div className="text-zinc-500 dark:text-zinc-400" style={{ height: alturaBarras }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tipos} layout="vertical" margin={{ left: 0, right: 24 }}>
                        <CartesianGrid horizontal={false} strokeOpacity={0.15} />
                        <XAxis type="number" allowDecimals={false} {...ejes} />
                        <YAxis type="category" dataKey="nombre" width={96} {...ejes} tickFormatter={(n) => (n.length > 13 ? `${n.slice(0, 12)}…` : n)} />
                        <Tooltip {...tooltipProps} formatter={(v) => [`${entero.format(v)} ingresadas`, '']} separator="" />
                        <Bar dataKey="ingresadas" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} label={{ position: 'right', fontSize: 11, fill: 'currentColor' }}>
                          {tipos.map((t) => <Cell key={t.id_tipo} fill={colorDe.get(t.id_tipo)} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Tarjeta>
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  <Tarjeta titulo="Vendidas vs. ingresadas" accion={
                    <span className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: APILADO[modo].ingresadas }} aria-hidden />Ingresadas</span>
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: APILADO[modo].pendientes }} aria-hidden />Pendientes</span>
                    </span>
                  }>
                    <div className="text-zinc-500 dark:text-zinc-400" style={{ height: alturaBarras }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={tipos} layout="vertical" margin={{ left: 0, right: 8 }} barCategoryGap="28%">
                          <CartesianGrid horizontal={false} strokeOpacity={0.15} />
                          <XAxis type="number" allowDecimals={false} {...ejes} />
                          <YAxis type="category" dataKey="nombre" width={96} {...ejes} tickFormatter={(n) => (n.length > 13 ? `${n.slice(0, 12)}…` : n)} />
                          <Tooltip {...tooltipProps} formatter={(v, n) => [entero.format(v), n === 'ingresadas' ? 'Ingresadas' : 'Pendientes']} />
                          {/* Hueco de 2px del color de fondo entre segmentos */}
                          <Bar dataKey="ingresadas" stackId="v" fill={APILADO[modo].ingresadas} stroke={modo === 'oscuro' ? '#18181b' : '#ffffff'} strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
                          <Bar dataKey="pendientes" stackId="v" fill={APILADO[modo].pendientes} stroke={modo === 'oscuro' ? '#18181b' : '#ffffff'} strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Tarjeta>
                </div>
                <div className="lg:col-span-2">
                  <Tarjeta titulo="Ranking · más consumidos" accion={<Trophy size={18} weight="duotone" className="text-zinc-400" aria-hidden />}>
                    <ol className="space-y-3" data-testid="ranking-ingresos">
                      {ranking.map((t, i) => (
                        <li key={t.id_tipo} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-zinc-400">{i + 1}</span>
                              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorDe.get(t.id_tipo) }} aria-hidden />
                              <span className="truncate font-medium">{t.nombre}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{entero.format(t.ingresadas)}/{entero.format(t.vendidas)}</span>
                          </div>
                          <BarraUso uso={t.uso} nivel={t.semaforo} etiqueta={`${t.nombre}: ${t.uso}% ingresó`} />
                        </li>
                      ))}
                    </ol>
                  </Tarjeta>
                </div>
              </div>
            </>
          )}

          {/* Detalle por tipo: tarjetas apilables (1 / 2 / 3 columnas) */}
          <section aria-labelledby="titulo-por-tipo">
            <h3 id="titulo-por-tipo" className="mb-3 text-lg font-semibold">Detalle por tipo de entrada</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="tipos-ingresos">
              {tipos.map((t) => (
                <article key={t.id_tipo} className="card min-w-0 space-y-3 p-4!" data-testid={`tipo-${t.id_tipo}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="flex min-w-0 items-center gap-2 font-semibold uppercase tracking-wide">
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: colorDe.get(t.id_tipo) }} aria-hidden />
                      <span className="truncate">{t.nombre}</span>
                    </h4>
                    <Semaforo nivel={t.semaforo} uso={t.uso} vendidas={t.vendidas} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    {[['Vendidas', t.vendidas], ['Ingresadas', t.ingresadas], ['Pendientes', t.pendientes]].map(([n, v]) => (
                      <div key={n} className="rounded-xl bg-zinc-50 px-1 py-2 dark:bg-white/5">
                        <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{n}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{entero.format(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <BarraUso uso={t.uso} nivel={t.semaforo} etiqueta={`${t.nombre}: ${t.uso}% de uso`} />
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between gap-2"><dt className="text-zinc-500 dark:text-zinc-400">Vendido</dt><dd className="tabular-nums">{importe(t.monto_vendido)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-zinc-500 dark:text-zinc-400">Ingresado</dt><dd className="tabular-nums">{importe(t.monto_consumido)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-zinc-500 dark:text-zinc-400">Pendiente</dt><dd className="tabular-nums font-medium">{importe(t.monto_pendiente)}</dd></div>
                  </dl>
                  {t.capacidad > 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">Cupo {entero.format(t.capacidad)} · {pct(t.vendidas, t.capacidad)}% vendido</p>}
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
