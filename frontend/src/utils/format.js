const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

/** Precio de un ticket: 0 se muestra como 'Gratis'. */
export const moneda = (n) => (Number(n) === 0 ? 'Gratis' : ARS.format(n));

/** Importe acumulado (recaudado, vendido): siempre en pesos, también cuando es 0. */
export const importe = (n) => ARS.format(Number(n) || 0);

export const fecha = (f) =>
  f ? new Date(f.replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

/** Colores de los estados (claro / oscuro). */
export const COLORES_ESTADO = {
  pendiente: 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  pagado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  valido: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  publicado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  conectado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  usado: 'bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300',
  cancelado: 'bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300',
  reembolsado: 'bg-sky-100 text-sky-800 dark:bg-sky-400/10 dark:text-sky-300',
  agotado: 'bg-orange-100 text-orange-800 dark:bg-orange-400/10 dark:text-orange-300',
  borrador: 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-400',
  finalizado: 'bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300',
  esperando: 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  notificado: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-300',
};
