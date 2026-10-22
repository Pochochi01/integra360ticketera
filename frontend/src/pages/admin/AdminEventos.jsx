import { useEffect, useState } from 'react';
import { adminApi, eventosApi, mensajeError, urlUpload } from '../../api/client';
import { AgregarEntradasModal, CobroDirectoModal, HistorialEvento } from '../../components/admin/EventoAdminExtras';
import { Plus, Wallet } from '@phosphor-icons/react';
import { Alerta, Badge, Modal, Spinner, useConfirmar } from '../../components/ui';
import { fecha, moneda } from '../../utils/format';

const EVENTO_VACIO = { nombre: '', descripcion: '', fecha: '', lugar: '', limite_por_persona: '', tiene_seating: false, estado: 'publicado' };
const TIPO_VACIO = { nombre_tipo: '', precio: '', stock_total: '', condiciones: '', venta_hasta: '', solo_admin: false };

export default function AdminEventos() {
  const confirmar = useConfirmar();
  const [eventos, setEventos] = useState(null);
  const [seleccionado, setSeleccionado] = useState(null);
  const [formEvento, setFormEvento] = useState(null);
  const [formTipo, setFormTipo] = useState(null);
  const [formAsientos, setFormAsientos] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [agregando, setAgregando] = useState(null); // tipo al que se le suman entradas
  const [cobrando, setCobrando] = useState(false);

  const cargar = () => eventosApi.listarTodos().then(setEventos).catch((e) => setError(mensajeError(e)));
  // Detalle público (asientos) + vista del admin (stock total y auditoría)
  const cargarDetalle = (id) =>
    Promise.all([eventosApi.detalle(id), adminApi.evento(id)]).then(([d, a]) => setSeleccionado({ ...d, ...a, asientos: d.asientos }));
  useEffect(() => { cargar(); }, []);

  const ejecutar = async (fn, exito) => {
    setError('');
    try {
      await fn();
      await cargar();
      if (seleccionado) await cargarDetalle(seleccionado.id_evento).catch(() => setSeleccionado(null));
      setAviso(exito);
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    }
  };

  const guardarEvento = async (e) => {
    e.preventDefault();
    const d = { ...formEvento, limite_por_persona: formEvento.limite_por_persona || null };
    // Edición: datos principales por el endpoint auditado; estado y seating (no auditados) por el de siempre
    const editar = async () => {
      const { nombre, fecha: f, lugar, descripcion, limite_por_persona } = d;
      await adminApi.actualizarEvento(d.id_evento, { nombre, fecha: f, lugar, descripcion: descripcion || '', limite_por_persona });
      if (d.estado !== seleccionado.estado || !!d.tiene_seating !== !!seleccionado.tiene_seating) {
        await eventosApi.actualizar(d.id_evento, { estado: d.estado, tiene_seating: d.tiene_seating });
      }
    };
    const ok = await ejecutar(() => (d.id_evento ? editar() : eventosApi.crear(d)), d.id_evento ? 'Evento actualizado' : 'Evento creado');
    if (ok) setFormEvento(null);
  };

  const guardarTipo = async (e) => {
    e.preventDefault();
    const d = { ...formTipo, venta_hasta: formTipo.venta_hasta || null };
    const ok = await ejecutar(
      () => (d.id_tipo ? eventosApi.actualizarTipo(d.id_tipo, d) : eventosApi.crearTipo(seleccionado.id_evento, d)),
      'Tipo de ticket guardado'
    );
    if (ok) setFormTipo(null);
  };

  const guardarAsientos = async (e) => {
    e.preventDefault();
    const d = {
      ...formAsientos,
      id_tipo: formAsientos.id_tipo ? Number(formAsientos.id_tipo) : null,
      filas: formAsientos.filas.split(',').map((f) => f.trim()).filter(Boolean),
    };
    const ok = await ejecutar(() => eventosApi.generarAsientos(seleccionado.id_evento, d), 'Asientos generados');
    if (ok) setFormAsientos(null);
  };

  const subirImagen = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) return setError('Formato no permitido (JPG, PNG o WEBP)');
    if (archivo.size > 3 * 1024 * 1024) return setError('La imagen supera los 3 MB');
    setSubiendo(true);
    await ejecutar(() => eventosApi.subirImagen(seleccionado.id_evento, archivo), 'Imagen actualizada');
    setSubiendo(false);
  };

  const set = (setter, obj) => (k) => (e) =>
    setter({ ...obj, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  if (!eventos) return <Spinner />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Administrar eventos</h1>
        <button className="btn-primary" onClick={() => setFormEvento(EVENTO_VACIO)}>+ Nuevo evento</button>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card divide-y divide-zinc-100 dark:divide-white/5 p-0! lg:col-span-2">
          {eventos.map((e) => (
            <button
              key={e.id_evento}
              onClick={() => cargarDetalle(e.id_evento)}
              className={`block w-full px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-white/5 ${seleccionado?.id_evento === e.id_evento ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{e.nombre}</span>
                <Badge estado={e.estado} />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{fecha(e.fecha)} · {e.lugar}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {!seleccionado ? (
            <p className="text-zinc-400 dark:text-zinc-500">Seleccioná un evento para gestionarlo.</p>
          ) : (
            <div className="card space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{seleccionado.nombre}</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {fecha(seleccionado.fecha)} · {seleccionado.lugar} · {seleccionado.limite_por_persona ? `máx. ${seleccionado.limite_por_persona}/persona` : 'sin límite'}
                    {seleccionado.tiene_seating ? ' · con seating plan' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary py-1!" disabled={['cancelado', 'finalizado'].includes(seleccionado.estado)} onClick={() => setCobrando(true)}>
                    <Wallet size={16} weight="bold" aria-hidden /> Cobrar con MercadoPago
                  </button>
                  <button
                    className="btn-secondary py-1!"
                    disabled={seleccionado.estado === 'cancelado'}
                    onClick={() => setFormEvento({ ...seleccionado, fecha: seleccionado.fecha.slice(0, 16).replace(' ', 'T'), limite_por_persona: seleccionado.limite_por_persona || '', tiene_seating: !!seleccionado.tiene_seating })}
                  >
                    Editar
                  </button>
                  <button
                    className="btn-danger py-1!"
                    disabled={seleccionado.estado === 'cancelado'}
                    onClick={async () => (await confirmar('Se reembolsan todas las ventas pagadas y se liberan las entradas. No se puede deshacer.', { titulo: 'Cancelar evento', aceptar: 'Cancelar evento', peligro: true })) &&
                      ejecutar(() => eventosApi.cancelar(seleccionado.id_evento), 'Evento cancelado y ventas reembolsadas')}
                  >
                    Cancelar evento
                  </button>
                  <button
                    className="btn-secondary py-1! text-rose-600 dark:text-rose-400"
                    onClick={async () => (await confirmar('Sólo se puede eliminar un evento sin ventas.', { titulo: 'Eliminar evento', aceptar: 'Eliminar', peligro: true })) &&
                      ejecutar(async () => { await eventosApi.eliminar(seleccionado.id_evento); setSeleccionado(null); }, 'Evento eliminado')}
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Stock del evento: suma de los tipos a la venta. Baja sólo con pagos confirmados */}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3" data-testid="stock-evento">
                <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5"><p className="text-xs text-zinc-500 dark:text-zinc-400">Disponibles</p><p className="text-lg font-semibold tabular-nums">{seleccionado.stock_disponible}</p></div>
                <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5"><p className="text-xs text-zinc-500 dark:text-zinc-400">Vendidas</p><p className="text-lg font-semibold tabular-nums">{seleccionado.stock_total - seleccionado.stock_disponible}</p></div>
                <div className="col-span-2 rounded-xl bg-zinc-50 px-3 py-2 sm:col-span-1 dark:bg-white/5"><p className="text-xs text-zinc-500 dark:text-zinc-400">Cupo total</p><p className="text-lg font-semibold tabular-nums">{seleccionado.stock_total}</p></div>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">Imagen del evento</h3>
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">Se muestra en la cartelera y se imprime junto al QR de cada entrada. JPG, PNG o WEBP, hasta 3 MB.</p>
                <div className="flex flex-wrap items-center gap-3">
                  {seleccionado.imagen_evento ? (
                    <img src={urlUpload(seleccionado.imagen_evento)} alt="Imagen del evento" className="h-24 w-44 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-24 w-44 items-center justify-center rounded-lg bg-zinc-100 dark:bg-white/10 text-xs text-zinc-400 dark:text-zinc-500">Sin imagen</div>
                  )}
                  <label className="btn-secondary py-1! cursor-pointer">
                    {subiendo ? 'Subiendo…' : seleccionado.imagen_evento ? 'Cambiar imagen' : 'Subir imagen'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={subiendo} onChange={subirImagen} data-testid="input-imagen" />
                  </label>
                  {seleccionado.imagen_evento && (
                    <button className="text-sm text-rose-600 dark:text-rose-400 hover:underline" onClick={() => ejecutar(() => eventosApi.quitarImagen(seleccionado.id_evento), 'Imagen quitada')}>Quitar</button>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">Tipos de ticket</h3>
                  <button className="btn-secondary py-1!" onClick={() => setFormTipo(TIPO_VACIO)}>+ Tipo</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="tabla [&_td]:pr-4 [&_th]:pr-4">
                    <thead className="text-left text-zinc-500 dark:text-zinc-400">
                      <tr><th className="py-2">Tipo</th><th>Precio</th><th>Stock</th><th>Condición</th><th /></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                      {seleccionado.tipos.map((t) => (
                        <tr key={t.id_tipo} className={t.activo ? '' : 'opacity-50'}>
                          <td className="py-2">{t.nombre_tipo} {t.solo_admin ? <span className="text-xs text-indigo-600 dark:text-indigo-400">(admin)</span> : null}</td>
                          <td className="whitespace-nowrap">{moneda(t.precio)}</td>
                          <td className="whitespace-nowrap">{t.stock_disponible} / {t.stock_total}</td>
                          <td className="text-xs text-zinc-500 dark:text-zinc-400">{t.venta_hasta ? `hasta ${fecha(t.venta_hasta)}` : t.condiciones}</td>
                          <td className="whitespace-nowrap text-right">
                            <button className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => setAgregando(t)} aria-label={`Agregar entradas a ${t.nombre_tipo}`}>
                              <Plus size={14} weight="bold" aria-hidden /> Entradas
                            </button>
                            <button className="ml-3 text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => setFormTipo({ ...t, venta_hasta: t.venta_hasta?.slice(0, 16).replace(' ', 'T') || '', solo_admin: !!t.solo_admin })}>Editar</button>
                            <button className="ml-3 text-rose-600 dark:text-rose-400 hover:underline" onClick={() => ejecutar(() => eventosApi.eliminarTipo(t.id_tipo), 'Tipo eliminado/desactivado')}>Quitar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <HistorialEvento auditoria={seleccionado.auditoria} />

              {!!seleccionado.tiene_seating && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">Seating plan ({seleccionado.asientos.length} asientos, {seleccionado.asientos.filter((a) => a.ocupado).length} ocupados)</h3>
                    <button className="btn-secondary py-1!" onClick={() => setFormAsientos({ sector: '', filas: '', asientos_por_fila: 10, id_tipo: '' })}>+ Generar asientos</button>
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {[...new Set(seleccionado.asientos.map((a) => a.sector))].join(' · ') || 'Sin asientos cargados'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {formEvento && (
        <Modal titulo={formEvento.id_evento ? 'Editar evento' : 'Nuevo evento'} onClose={() => setFormEvento(null)}>
          <form onSubmit={guardarEvento} className="space-y-3">
            <input className="input" placeholder="Nombre" value={formEvento.nombre} onChange={set(setFormEvento, formEvento)('nombre')} required />
            <textarea className="input" placeholder="Descripción" value={formEvento.descripcion || ''} onChange={set(setFormEvento, formEvento)('descripcion')} />
            <input className="input" type="datetime-local" value={formEvento.fecha} onChange={set(setFormEvento, formEvento)('fecha')} required />
            <input className="input" placeholder="Lugar" value={formEvento.lugar} onChange={set(setFormEvento, formEvento)('lugar')} required />
            <input className="input" type="number" min="1" placeholder="Límite por persona (vacío = sin límite)" value={formEvento.limite_por_persona} onChange={set(setFormEvento, formEvento)('limite_por_persona')} />
            <select className="input" value={formEvento.estado} onChange={set(setFormEvento, formEvento)('estado')}>
              {['borrador', 'publicado', 'agotado', 'finalizado'].map((e) => <option key={e}>{e}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formEvento.tiene_seating} onChange={set(setFormEvento, formEvento)('tiene_seating')} /> Con seating plan (asientos numerados)
            </label>
            <button className="btn-primary w-full">Guardar</button>
          </form>
        </Modal>
      )}

      {formTipo && (
        <Modal titulo={formTipo.id_tipo ? 'Editar tipo de ticket' : 'Nuevo tipo de ticket'} onClose={() => setFormTipo(null)}>
          <form onSubmit={guardarTipo} className="space-y-3">
            <input className="input" placeholder="Nombre (General, VIP, Early Bird…)" value={formTipo.nombre_tipo} onChange={set(setFormTipo, formTipo)('nombre_tipo')} required />
            <div className="grid grid-cols-2 gap-3">
              <input className="input" type="number" min="0" step="0.01" placeholder="Precio" value={formTipo.precio} onChange={set(setFormTipo, formTipo)('precio')} required />
              <input className="input" type="number" min="0" placeholder="Cupo total" value={formTipo.stock_total} onChange={set(setFormTipo, formTipo)('stock_total')} required />
            </div>
            <input className="input" placeholder="Condiciones" value={formTipo.condiciones || ''} onChange={set(setFormTipo, formTipo)('condiciones')} />
            <label className="label" htmlFor="campo-admineventos-venta-hasta-opcional-ej-early-bird">Venta hasta (opcional, ej. Early Bird)</label>
            <input id="campo-admineventos-venta-hasta-opcional-ej-early-bird" className="input" type="datetime-local" value={formTipo.venta_hasta} onChange={set(setFormTipo, formTipo)('venta_hasta')} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formTipo.solo_admin} onChange={set(setFormTipo, formTipo)('solo_admin')} /> Solo emisión administrativa (invitaciones / corporativo)
            </label>
            <button className="btn-primary w-full">Guardar</button>
          </form>
        </Modal>
      )}

      {agregando && (
        <AgregarEntradasModal
          evento={seleccionado}
          tipo={agregando}
          onClose={() => setAgregando(null)}
          onListo={async (_ev, mensaje) => { setAgregando(null); await ejecutar(async () => {}, mensaje); }}
        />
      )}
      {cobrando && <CobroDirectoModal evento={seleccionado} onClose={() => setCobrando(false)} />}

      {formAsientos && (
        <Modal titulo="Generar asientos" onClose={() => setFormAsientos(null)}>
          <form onSubmit={guardarAsientos} className="space-y-3">
            <input className="input" placeholder="Sector (ej. Platea)" value={formAsientos.sector} onChange={set(setFormAsientos, formAsientos)('sector')} required />
            <input className="input" placeholder="Filas separadas por coma (A,B,C)" value={formAsientos.filas} onChange={set(setFormAsientos, formAsientos)('filas')} required />
            <input className="input" type="number" min="1" placeholder="Asientos por fila" value={formAsientos.asientos_por_fila} onChange={set(setFormAsientos, formAsientos)('asientos_por_fila')} required />
            <select className="input" value={formAsientos.id_tipo} onChange={set(setFormAsientos, formAsientos)('id_tipo')} required>
              <option value="">Tipo de ticket asociado…</option>
              {seleccionado.tipos.map((t) => <option key={t.id_tipo} value={t.id_tipo}>{t.nombre_tipo}</option>)}
            </select>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Recordá que el cupo del tipo debe coincidir con la cantidad de asientos.</p>
            <button className="btn-primary w-full">Generar</button>
          </form>
        </Modal>
      )}
    </>
  );
}
