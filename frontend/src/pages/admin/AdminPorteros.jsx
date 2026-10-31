import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Copy, DoorOpen, Key, ShieldCheck, Trash, UserPlus } from '@phosphor-icons/react';
import { accesoApi, mensajeError, porterosApi } from '../../api/client';
import { Alerta, Badge, Modal, Spinner, Tabs, Vacio, useConfirmar } from '../../components/ui';
import ControlIngresos from '../../components/admin/estadisticas/ControlIngresos';
import VentaPuerta from '../../components/admin/estadisticas/VentaPuerta';
import { fecha } from '../../utils/format';

/** Copia un valor y confirma con un check durante un instante. */
function Copiable({ etiqueta, valor }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { /* sin portapapeles: el valor queda visible para copiarlo a mano */ }
  };
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{etiqueta}</p>
      <div className="mt-1 flex items-center gap-2 rounded-xl bg-zinc-100 py-1.5 pl-3 pr-1.5 dark:bg-white/5">
        <code className="min-w-0 flex-1 truncate font-mono text-base font-semibold text-zinc-900 select-all dark:text-white">{valor}</code>
        <button type="button" onClick={copiar} aria-label={`Copiar ${etiqueta.toLowerCase()}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 transition-[transform,background-color] duration-150 hover:bg-zinc-900/5 active:scale-[0.94] dark:text-zinc-400 dark:hover:bg-white/10">
          {copiado ? <Check size={18} weight="bold" className="text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Copy size={18} weight="bold" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

/**
 * /admin/porteros — el administrador crea usuarios "portero" para la puerta de su complejo.
 * El sistema genera usuario y contraseña; la contraseña se muestra una sola vez.
 */
export default function AdminPorteros() {
  const reducir = useReducedMotion();
  const confirmar = useConfirmar();
  const [porteros, setPorteros] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [nuevo, setNuevo] = useState(null); // { nombre, apellido }
  const [credenciales, setCredenciales] = useState(null); // { titulo, usuario, password }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Pestaña en la URL: /admin/porteros/venta abre directo la venta en puerta (boletería)
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [tab, setTabEstado] = useState(pathname.endsWith('/venta') ? 'venta' : 'ingresos');
  const setTab = (t) => { setTabEstado(t); navigate(t === 'venta' ? '/admin/porteros/venta' : '/admin/porteros', { replace: true }); };

  const cargar = () => Promise.all([
    porterosApi.listar().then(setPorteros),
    accesoApi.historial().then(setHistorial).catch(() => {}),
  ]).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  const crear = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await porterosApi.crear(nuevo);
      setNuevo(null);
      setCredenciales({ titulo: `Portero creado: ${r.portero.nombre}${r.portero.apellido ? ` ${r.portero.apellido}` : ''}`, ...r.credenciales });
      await cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  const accion = async (fn) => {
    try { await fn(); await cargar(); } catch (err) { setError(mensajeError(err)); }
  };

  const regenerar = async (p) => {
    if (!(await confirmar('La contraseña actual deja de funcionar y se genera una nueva.', { titulo: `Nueva contraseña para ${p.usuario}`, aceptar: 'Generar contraseña' }))) return;
    accion(async () => {
      const r = await porterosApi.regenerarPassword(p.id_portero);
      setCredenciales({ titulo: `Nueva contraseña de ${p.nombre}`, ...r });
    });
  };

  const eliminar = async (p) => {
    if (!(await confirmar('Si ya registró lecturas en la puerta no se puede eliminar: desactivalo para conservar el historial.', { titulo: `Eliminar a ${p.usuario}`, aceptar: 'Eliminar', peligro: true }))) return;
    accion(() => porterosApi.eliminar(p.id_portero));
  };

  if (!porteros) return error ? <Alerta>{error}</Alerta> : <Spinner />;
  const activos = porteros.filter((p) => p.estado === 'activo').length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Porteros</h1>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            {tab === 'ingresos'
              ? 'Ingresos al evento en tiempo real, por tipo de entrada.'
              : tab === 'venta' ? 'QR de compra para la puerta y cobro en boletería con Mercado Pago.'
              : <>Usuarios de la puerta: sólo pueden entrar a la Portería y escanear entradas. {activos} activo{activos === 1 ? '' : 's'}.</>}
          </p>
        </div>
        {tab === 'equipo' && (
          <button className="btn-primary" onClick={() => setNuevo({ nombre: '', apellido: '' })}>
            <UserPlus size={18} weight="bold" aria-hidden /> Nuevo portero
          </button>
        )}
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>

      <Tabs tabs={[['ingresos', 'Control de ingresos'], ['venta', 'Venta en puerta'], ['equipo', `Porteros (${porteros.length})`]]} activa={tab} onChange={setTab} />

      {tab === 'ingresos' && <ControlIngresos />}
      {tab === 'venta' && <VentaPuerta />}

      {tab === 'equipo' && <div className="grid gap-8 lg:grid-cols-5">
        <section className="min-w-0 lg:col-span-3">
          {porteros.length === 0 ? (
            <Vacio icono={DoorOpen} titulo="Todavía no hay porteros"
              accion={<button className="btn-primary mt-2" onClick={() => setNuevo({ nombre: '', apellido: '' })}>Crear el primero</button>}>
              Creá un usuario por persona que controle la puerta. El sistema genera el usuario y la contraseña.
            </Vacio>
          ) : (
            <ul className="space-y-3">
              <AnimatePresence initial={false}>
                {porteros.map((p) => (
                  <motion.li
                    key={p.id_portero}
                    layout={!reducir}
                    initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }}
                    animate={{ opacity: 1, transform: 'translateY(0px)' }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                    className={`card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${p.estado === 'activo' ? '' : 'opacity-60'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{p.nombre} {p.apellido}</p>
                        <Badge estado={p.estado === 'activo' ? 'valido' : 'usado'} texto={p.estado} />
                      </div>
                      <p className="mt-0.5 truncate font-mono text-sm text-indigo-700 dark:text-indigo-300">{p.usuario}</p>
                      <p className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                        {p.ingresos} ingresos · {p.lecturas} lecturas{p.ultima_lectura ? ` · última ${fecha(p.ultima_lectura)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button className="btn-secondary py-1!" onClick={() => regenerar(p)}><Key size={16} weight="bold" aria-hidden /> Contraseña</button>
                      <button className="btn-secondary py-1!" onClick={() => accion(() => porterosApi.actualizar(p.id_portero, { estado: p.estado === 'activo' ? 'inactivo' : 'activo' }))}>
                        {p.estado === 'activo' ? 'Desactivar' : 'Activar'}
                      </button>
                      <button className="btn-secondary py-1! text-rose-700! dark:text-rose-300!" onClick={() => eliminar(p)} aria-label={`Eliminar a ${p.usuario}`}>
                        <Trash size={16} weight="bold" aria-hidden />
                      </button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>

        <section className="min-w-0 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Actividad en la puerta</h2>
          {historial.length === 0 ? (
            <Vacio icono={ShieldCheck} titulo="Sin lecturas todavía">Cada entrada que escaneen tus porteros aparece acá.</Vacio>
          ) : (
            <ul className="card divide-y divide-zinc-100 p-0! dark:divide-white/5">
              {historial.slice(0, 15).map((h) => (
                <li key={h.id_acceso} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${h.resultado === 'valido' ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.evento || <span className="font-mono text-xs">{h.codigo_leido}</span>}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {h.resultado === 'valido' ? 'Permitida' : h.resultado === 'usado' ? 'Denegada · ya usada' : 'Denegada'} · {h.validador}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{fecha(h.fecha)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>}

      {nuevo && (
        <Modal titulo="Nuevo portero" onClose={() => setNuevo(null)}>
          <form onSubmit={crear} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="portero-nombre">Nombre</label>
                <input id="portero-nombre" className="input" required maxLength={80} autoFocus value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="portero-apellido">Apellido (opcional)</label>
                <input id="portero-apellido" className="input" maxLength={80} value={nuevo.apellido} onChange={(e) => setNuevo({ ...nuevo, apellido: e.target.value })} />
              </div>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">El usuario y la contraseña se generan automáticamente. Sólo podrá usar la Portería.</p>
            <button className="btn-primary w-full" disabled={guardando}>{guardando ? 'Creando…' : 'Crear y generar acceso'}</button>
          </form>
        </Modal>
      )}

      {credenciales && (
        <Modal titulo={credenciales.titulo} onClose={() => setCredenciales(null)}>
          <div className="space-y-4">
            <Copiable etiqueta="Usuario" valor={credenciales.usuario} />
            <Copiable etiqueta="Contraseña" valor={credenciales.password} />
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
              Anotala ahora: por seguridad no se vuelve a mostrar. Si se pierde, generá una nueva.
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Ingresa en <b>Ingresar</b> con este usuario y entra directo a la Portería.</p>
            <button className="btn-primary w-full" onClick={() => setCredenciales(null)}>Listo</button>
          </div>
        </Modal>
      )}
    </>
  );
}
