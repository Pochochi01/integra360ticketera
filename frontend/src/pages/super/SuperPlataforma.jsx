import { useEffect, useState } from 'react';
import { integracionesApi, mensajeError, suscripcionesApi } from '../../api/client';
import { Alerta, Spinner } from '../../components/ui';
import { moneda } from '../../utils/format';
import { Wallet } from '@phosphor-icons/react';

const TOKEN_RE = /^(APP_USR|TEST)-[\w-]{8,}$/;

/** Superadmin: cuenta MercadoPago de la plataforma (cobro de suscripciones) y planes. */
export default function SuperPlataforma() {
  const [mp, setMp] = useState(null);
  const [form, setForm] = useState({ access_token: '', public_key: '', modo: 'produccion', webhook_secret: '' });
  const [planes, setPlanes] = useState([]);
  const [nuevoPlan, setNuevoPlan] = useState({ nombre: '', descripcion: '', precio_mensual: '' });
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = async () => {
    const [m, p] = await Promise.all([integracionesApi.mercadoPagoPlataforma(), suscripcionesApi.planes()]);
    setMp(m);
    setPlanes(p);
    if (m.integracion) setForm((f) => ({ ...f, public_key: m.integracion.public_key, modo: m.integracion.modo }));
  };
  useEffect(() => { cargar().catch((e) => setError(mensajeError(e))); }, []);

  const accion = async (fn, exito) => {
    setError('');
    try {
      await fn();
      await cargar();
      setAviso(exito);
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    }
  };

  if (!mp) return error ? <Alerta>{error}</Alerta> : <Spinner />;
  const existente = mp.integracion;
  const mpValido = (existente || TOKEN_RE.test(form.access_token)) && (!form.access_token || TOKEN_RE.test(form.access_token)) && TOKEN_RE.test(form.public_key);
  const planValido = nuevoPlan.nombre.trim() && Number(nuevoPlan.precio_mensual) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Plataforma</h1>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); accion(() => integracionesApi.guardarMercadoPagoPlataforma({ ...form, access_token: form.access_token || undefined, webhook_secret: form.webhook_secret || undefined }), 'Cuenta de la plataforma verificada y guardada'); }}>
        <h2 className="text-lg font-semibold"><Wallet size={22} weight="duotone" className="mr-2 inline text-indigo-600 dark:text-indigo-400" aria-hidden />MercadoPago de la plataforma</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Con esta cuenta se cobran las suscripciones de los complejos.</p>
        {existente && <p className="rounded-lg bg-zinc-50 dark:bg-white/5 p-2 text-xs">Token: <span className="font-mono">{existente.access_token}</span> · Collector {existente.collector_id} · modo {existente.modo}</p>}
        <input className="input font-mono" type="password" autoComplete="off" placeholder={existente ? 'Access token (vacío = conservar)' : 'Access token APP_USR-…'} value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} />
        <input className="input font-mono" placeholder="Public key APP_USR-…" value={form.public_key} onChange={(e) => setForm({ ...form, public_key: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <select className="input" value={form.modo} onChange={(e) => setForm({ ...form, modo: e.target.value })}>
            <option value="produccion">Producción</option><option value="prueba">Prueba</option>
          </select>
          <input className="input font-mono" type="password" placeholder="Clave secreta de webhooks" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} />
        </div>
        <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">Webhook: <span className="font-mono">{mp.webhook_url}</span></p>
        <button className="btn-primary" disabled={!mpValido}>Verificar y guardar</button>
      </form>

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Planes</h2>
        {planes.map((p) => (
          <div key={p.id_plan} className="flex items-center justify-between border-b border-zinc-100 dark:border-white/5 py-2 text-sm">
            <span><b>{p.nombre}</b> · {moneda(p.precio_mensual)}/mes <span className="text-zinc-400 dark:text-zinc-500">{p.descripcion}</span></span>
            <button className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => accion(() => suscripcionesApi.actualizarPlan(p.id_plan, { activo: !p.activo }), 'Plan actualizado')}>
              {p.activo ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
        <form className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]" onSubmit={async (e) => { e.preventDefault(); if (await accion(() => suscripcionesApi.crearPlan({ ...nuevoPlan, precio_mensual: Number(nuevoPlan.precio_mensual) }), 'Plan creado')) setNuevoPlan({ nombre: '', descripcion: '', precio_mensual: '' }); }}>
          <input className="input" placeholder="Nombre" maxLength={80} value={nuevoPlan.nombre} onChange={(e) => setNuevoPlan({ ...nuevoPlan, nombre: e.target.value })} />
          <input className="input" placeholder="Descripción" value={nuevoPlan.descripcion} onChange={(e) => setNuevoPlan({ ...nuevoPlan, descripcion: e.target.value })} />
          <input className="input" type="number" min="1" placeholder="Precio" value={nuevoPlan.precio_mensual} onChange={(e) => setNuevoPlan({ ...nuevoPlan, precio_mensual: e.target.value })} />
          <button className="btn-primary" disabled={!planValido}>+ Plan</button>
        </form>
      </div>
    </div>
  );
}
