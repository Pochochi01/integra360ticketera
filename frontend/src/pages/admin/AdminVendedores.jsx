import { useEffect, useState } from 'react';
import { mensajeError, vendedoresApi } from '../../api/client';
import { Alerta, Badge, Modal, Spinner, useConfirmar } from '../../components/ui';
import WhatsappInput from '../../components/WhatsappInput';
import { fecha, importe, moneda } from '../../utils/format';

const VACIO = { nombre: '', apellido: '', dni: '', whatsapp: '', email: '', password: '', estado: 'activo' };

/** CRUD de vendedores (puntos de venta) del complejo. */
export default function AdminVendedores() {
  const confirmar = useConfirmar();
  const [vendedores, setVendedores] = useState(null);
  const [form, setForm] = useState(null);
  const [whatsappOk, setWhatsappOk] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const cargar = () => vendedoresApi.listar().then(setVendedores).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    const { id_vendedor, ...datos } = form;
    if (id_vendedor && !datos.password) delete datos.password;
    try {
      if (id_vendedor) await vendedoresApi.actualizar(id_vendedor, datos);
      else await vendedoresApi.crear(datos);
      setAviso(id_vendedor ? 'Vendedor actualizado' : 'Vendedor creado con un link general listo para compartir');
      setForm(null);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const cambiarEstado = async (v) => {
    try {
      await vendedoresApi.actualizar(v.id_vendedor, { estado: v.estado === 'activo' ? 'inactivo' : 'activo' });
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const eliminar = async (v) => {
    if (!(await confirmar('Si tiene ventas registradas se desactiva en lugar de eliminarse.', { titulo: `Eliminar a ${v.nombre} ${v.apellido}`, aceptar: 'Eliminar', peligro: true }))) return;
    try {
      const r = await vendedoresApi.eliminar(v.id_vendedor);
      setAviso(r?.mensaje || 'Vendedor eliminado');
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const verDetalle = async (v) => {
    const [d, ventas] = await Promise.all([vendedoresApi.detalle(v.id_vendedor), vendedoresApi.ventas(v.id_vendedor)]);
    setDetalle({ ...d, ventas });
  };

  if (!vendedores) return <Spinner />;
  const filtrados = vendedores.filter((v) => `${v.nombre} ${v.apellido} ${v.dni} ${v.email}`.toLowerCase().includes(busqueda.toLowerCase()));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Vendedores</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {vendedores.filter((v) => v.estado === 'activo').length} activos · {importe(vendedores.reduce((s, v) => s + Number(v.monto_vendido), 0))} vendidos
          </p>
        </div>
        <div className="flex gap-2">
          <input className="input" placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <button className="btn-primary shrink-0" onClick={() => { setForm(VACIO); setWhatsappOk(null); }}>+ Nuevo vendedor</button>
        </div>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <div className="card overflow-x-auto p-0!">
        <table className="tabla">
          <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
            <tr><th className="p-3">Vendedor</th><th className="p-3">DNI</th><th className="p-3">WhatsApp</th><th className="p-3">Ventas</th><th className="p-3">Entradas</th><th className="p-3">Vendido</th><th className="p-3">Estado</th><th className="p-3" /></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {filtrados.map((v) => (
              <tr key={v.id_vendedor}>
                <td className="p-3">
                  <button className="font-medium text-indigo-700 dark:text-indigo-300 hover:underline" onClick={() => verDetalle(v)}>{v.apellido}, {v.nombre}</button>
                  <div className="text-xs text-zinc-400 dark:text-zinc-500">{v.email}</div>
                </td>
                <td className="p-3">{v.dni}</td>
                <td className="p-3">
                  <a className="text-emerald-700 dark:text-emerald-300 hover:underline" href={`https://wa.me/${v.whatsapp.replace('+', '')}`} target="_blank" rel="noreferrer">{v.whatsapp}</a>
                </td>
                <td className="p-3">{v.ventas_pagadas}</td>
                <td className="p-3">{v.tickets_vendidos}</td>
                <td className="p-3">{importe(v.monto_vendido)}</td>
                <td className="p-3"><button onClick={() => cambiarEstado(v)} title="Cambiar estado"><Badge estado={v.estado} /></button></td>
                <td className="whitespace-nowrap p-3 text-right">
                  <button className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => { setForm({ ...v, password: '' }); setWhatsappOk(v.whatsapp); }}>Editar</button>
                  <button className="ml-3 text-rose-600 dark:text-rose-400 hover:underline" onClick={() => eliminar(v)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-zinc-400 dark:text-zinc-500">Sin vendedores</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo={form.id_vendedor ? 'Editar vendedor' : 'Nuevo vendedor'} onClose={() => setForm(null)}>
          <form onSubmit={guardar} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="campo-adminvendedores-nombre">Nombre</label><input id="campo-adminvendedores-nombre" className="input" value={form.nombre} onChange={set('nombre')} required /></div>
              <div><label className="label" htmlFor="campo-adminvendedores-apellido">Apellido</label><input id="campo-adminvendedores-apellido" className="input" value={form.apellido} onChange={set('apellido')} required /></div>
            </div>
            <div><label className="label" htmlFor="campo-adminvendedores-dni">DNI</label><input id="campo-adminvendedores-dni" className="input" inputMode="numeric" pattern="\d{6,12}" value={form.dni} onChange={set('dni')} required /></div>
            <WhatsappInput value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} onValidez={setWhatsappOk} />
            <div><label className="label" htmlFor="campo-adminvendedores-email-usuario-de-acceso">Email (usuario de acceso)</label><input id="campo-adminvendedores-email-usuario-de-acceso" className="input" type="email" value={form.email} onChange={set('email')} required /></div>
            <div>
              <label className="label" htmlFor="campo-vendedor-contrasena">{form.id_vendedor ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}</label>
              <input id="campo-vendedor-contrasena" className="input" type="password" minLength={6} value={form.password} onChange={set('password')} required={!form.id_vendedor} />
            </div>
            <div>
              <label className="label" htmlFor="campo-adminvendedores-estado">Estado</label>
              <select id="campo-adminvendedores-estado" className="input" value={form.estado} onChange={set('estado')}>
                <option value="activo">Activo</option><option value="inactivo">Inactivo (bloquea acceso y links)</option>
              </select>
            </div>
            <button className="btn-primary w-full" disabled={!whatsappOk}>Guardar</button>
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal titulo={`${detalle.nombre} ${detalle.apellido}`} onClose={() => setDetalle(null)}>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto text-sm">
            <div>
              <h4 className="mb-2 font-semibold">Links</h4>
              {detalle.links.map((l) => (
                <div key={l.id_link} className="flex justify-between border-b border-zinc-100 dark:border-white/5 py-1">
                  <span><span className="font-mono">/v/{l.codigo}</span> · {l.evento || 'General'} {!l.activo && '(pausado)'}</span>
                  <span className="text-zinc-400 dark:text-zinc-500">{l.visitas} visitas · {l.ventas_pagadas} ventas</span>
                </div>
              ))}
            </div>
            <div>
              <h4 className="mb-2 font-semibold">Ventas</h4>
              {detalle.ventas.map((v) => (
                <div key={v.id_venta} className="flex items-center justify-between border-b border-zinc-100 dark:border-white/5 py-1">
                  <span>#{v.id_venta} · {v.evento} · {v.comprador}<div className="text-xs text-zinc-400 dark:text-zinc-500">{fecha(v.fecha_venta)}</div></span>
                  <span className="flex items-center gap-2">{moneda(v.monto_total)} <Badge estado={v.estado} /></span>
                </div>
              ))}
              {detalle.ventas.length === 0 && <p className="text-zinc-400 dark:text-zinc-500">Sin ventas</p>}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
