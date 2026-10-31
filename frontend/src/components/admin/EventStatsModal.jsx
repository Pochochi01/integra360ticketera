import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CurrencyCircleDollar, Hourglass, Percent, Ticket } from '@phosphor-icons/react';
import { adminApi } from '../../api/client';
import { Alerta, Modal, Skeleton } from '../ui';
import { importe } from '../../utils/format';
import { Actualizado, compacto, ejes, Kpi, REFRESCO_MS, Tarjeta, tooltipProps, useConsultaEnVivo } from './estadisticas/comun';

// Reexportados: /admin/ventas los importa desde acá
export { Actualizado, REFRESCO_MS };

// Paleta categórica (legible en claro y oscuro); el primer color es el de la marca
const COLORES = ['#4f46e5', '#0891b2', '#f59e0b', '#10b981', '#e11d48', '#8b5cf6', '#64748b'];
const METODOS = { mercadopago: 'MercadoPago', efectivo: 'Efectivo', transferencia: 'Transferencia', cortesia: 'Cortesía', tarjeta: 'Tarjeta', billetera: 'Billetera' };
const unidades = (n) => `${n} entrada${n === 1 ? '' : 's'}`;

/**
 * Estadísticas de un evento (GET /api/admin/event/:id/stats), refrescadas cada 10 s mientras la pestaña
 * está visible (y al volver a ella). Así se ven al instante los pagos que MercadoPago confirma por webhook.
 */
export function useEstadisticasEvento(idEvento) {
  const { datos, ...resto } = useConsultaEnVivo(idEvento ? () => adminApi.estadisticasEvento(idEvento) : null, idEvento);
  return { stats: datos, ...resto };
}

/** Selector Pesos / Unidades para los gráficos. */
const Medida = ({ valor, onChange }) => (
  <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-white/5" role="group" aria-label="Medida del gráfico">
    {[['monto', '$'], ['unidades', 'Unid.']].map(([v, t]) => (
      <button key={v} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}
        className={`rounded-md px-2 py-0.5 font-medium transition-colors ${valor === v ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>{t}</button>
    ))}
  </div>
);

/**
 * Modal de estadísticas del evento: generales, por vendedor/canal (barras + tabla), por medio de pago
 * (torta), por tipo de entrada (vendidas vs. stock) y evolución diaria. Recibe los datos del hook
 * useEstadisticasEvento del padre (una sola consulta cada 10 s para la tarjeta y el modal).
 */
export default function EventStatsModal({ stats, error, cargando, onActualizar, onClose }) {
  const [medida, setMedida] = useState('monto');
  // En celulares el eje de nombres se angosta para dejarle lugar a las barras
  const [angosto] = useState(() => window.matchMedia('(max-width: 639.98px)').matches);
  const fmt = (v) => (medida === 'monto' ? importe(v) : unidades(v));
  const fmtEje = (v) => (medida === 'monto' ? `$${compacto.format(v)}` : v);

  return (
    <Modal titulo={stats ? `Estadísticas · ${stats.evento.nombre}` : 'Estadísticas del evento'} onClose={onClose} ancho="max-w-5xl">
      <div className="space-y-4" data-testid="event-stats-modal">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Sólo ventas confirmadas (pagos aprobados por MercadoPago y cobros validados).</p>
          <Actualizado en={stats?.actualizado_en} cargando={cargando} onActualizar={onActualizar} />
        </div>
        <Alerta>{error}</Alerta>

        {!stats ? (
          <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}<Skeleton className="h-64 sm:col-span-4" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stats-generales">
              <Kpi icono={Ticket} titulo="Entradas vendidas" valor={stats.generales.unidades} detalle={`${stats.generales.ventas} compra${stats.generales.ventas === 1 ? '' : 's'} · quedan ${stats.evento.stock_disponible}`} />
              <Kpi icono={CurrencyCircleDollar} tono="emerald" titulo="Ingresos totales" valor={importe(stats.generales.ingresos)} detalle={`MercadoPago ${importe(stats.generales.ingresos_mercadopago)}`} />
              <Kpi icono={Percent} tono="sky" titulo="Ocupación" valor={`${stats.generales.ocupacion}%`} detalle={`Promedio ${importe(stats.generales.ticket_promedio)} por entrada`} />
              <Kpi icono={Hourglass} tono="amber" titulo="Pagos en curso" valor={stats.generales.pendientes.ventas} detalle={`${unidades(stats.generales.pendientes.unidades)} · ${importe(stats.generales.pendientes.monto)}`} />
            </div>

            {/* Ocupación como barra: lectura inmediata del avance */}
            <div aria-hidden className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/5">
              <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-500" style={{ width: `${Math.min(100, stats.generales.ocupacion)}%` }} />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <Tarjeta titulo="Por vendedor" accion={<Medida valor={medida} onChange={setMedida} />}>
                  {stats.por_vendedor.length === 0 ? (
                    <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Todavía no hay ventas confirmadas.</p>
                  ) : (
                    <>
                      <div className="text-zinc-500 dark:text-zinc-400" style={{ height: Math.max(160, stats.por_vendedor.length * 40) }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.por_vendedor} layout="vertical" margin={{ left: 0, right: 16 }}>
                            <CartesianGrid horizontal={false} strokeOpacity={0.15} />
                            <XAxis type="number" {...ejes} tickFormatter={fmtEje} allowDecimals={medida === 'monto'} />
                            <YAxis type="category" dataKey="nombre" width={angosto ? 84 : 140} {...ejes} tickFormatter={(n) => (angosto && n.length > 18 ? `${n.slice(0, 17)}…` : n)} />
                            <Tooltip {...tooltipProps} formatter={(v) => [fmt(v), medida === 'monto' ? 'Monto' : 'Entradas']} />
                            <Bar dataKey={medida} radius={[0, 6, 6, 0]} maxBarSize={26} isAnimationActive={false}>
                              {stats.por_vendedor.map((v, i) => <Cell key={v.clave} fill={COLORES[i % COLORES.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <table className="mt-3 w-full text-sm" data-testid="stats-vendedores">
                        <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                          <tr><th className="py-1 font-medium">Canal</th><th className="py-1 text-right font-medium">Entradas</th><th className="py-1 text-right font-medium">Monto</th><th className="py-1 text-right font-medium">%</th></tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                          {stats.por_vendedor.map((v, i) => (
                            <tr key={v.clave}>
                              <td className="py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: COLORES[i % COLORES.length] }} aria-hidden />{v.nombre}</td>
                              <td className="py-1.5 text-right tabular-nums">{v.unidades}</td>
                              <td className="py-1.5 text-right tabular-nums">{importe(v.monto)}</td>
                              <td className="py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{stats.generales.ingresos ? Math.round((v.monto / stats.generales.ingresos) * 100) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </Tarjeta>
              </div>

              <div className="lg:col-span-2">
                <Tarjeta titulo="Por medio de pago">
                  {stats.por_metodo.length === 0 ? (
                    <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Sin datos.</p>
                  ) : (
                    <>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={stats.por_metodo} dataKey={medida} nameKey="metodo" innerRadius="55%" outerRadius="90%" paddingAngle={2} isAnimationActive={false}>
                              {stats.por_metodo.map((m, i) => <Cell key={m.metodo} fill={COLORES[i % COLORES.length]} stroke="none" />)}
                            </Pie>
                            <Tooltip {...tooltipProps} formatter={(v, n) => [fmt(v), METODOS[n] || n]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {stats.por_metodo.map((m, i) => (
                          <li key={m.metodo} className="flex items-center justify-between gap-2">
                            <span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: COLORES[i % COLORES.length] }} aria-hidden />{METODOS[m.metodo] || m.metodo}</span>
                            <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{m.unidades} · {importe(m.monto)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Tarjeta>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Tarjeta titulo="Por tipo de entrada (vendidas / stock)">
                <ul className="space-y-2.5 text-sm">
                  {stats.por_tipo.map((t) => {
                    const total = t.unidades + t.stock_disponible;
                    const pct = total ? (t.unidades / total) * 100 : 0;
                    return (
                      <li key={t.id_tipo}>
                        <div className="flex justify-between gap-2"><span className="truncate">{t.nombre}</span><span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{t.unidades} / {total}</span></div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/5" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.nombre}: ${Math.round(pct)}% vendido`}>
                          <div className="h-full rounded-full bg-cyan-600" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Tarjeta>
              <Tarjeta titulo="Últimos 30 días">
                {stats.por_dia.length === 0 ? (
                  <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Sin ventas en los últimos 30 días.</p>
                ) : (
                  <div className="h-44 text-zinc-500 dark:text-zinc-400">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.por_dia} margin={{ left: -12, right: 4 }}>
                        <CartesianGrid vertical={false} strokeOpacity={0.15} />
                        <XAxis dataKey="dia" {...ejes} tickFormatter={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)} />
                        <YAxis {...ejes} tickFormatter={fmtEje} allowDecimals={medida === 'monto'} />
                        <Tooltip {...tooltipProps} labelFormatter={(d) => d.split('-').reverse().join('/')} formatter={(v) => [fmt(v), medida === 'monto' ? 'Monto' : 'Entradas']} />
                        <Bar dataKey={medida} fill={COLORES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Tarjeta>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
