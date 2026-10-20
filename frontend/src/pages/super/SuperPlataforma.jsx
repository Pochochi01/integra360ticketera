import { useEffect, useState } from 'react';
import { mensajeError, suscripcionesApi } from '../../api/client';
import MercadoPagoConexion from '../../components/MercadoPagoConexion';
import { Alerta, Spinner } from '../../components/ui';
import { moneda } from '../../utils/format';

/** Superadmin: cuenta MercadoPago de la plataforma (OAuth, cobro de suscripciones) y planes. */
export default function SuperPlataforma() {
  const [planes, setPlanes] = useState(null);
  const [nuevoPlan, setNuevoPlan] = useState({ nombre: '', descripcion: '', precio_mensual: '' });
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = async () => setPlanes(await suscripcionesApi.planes());
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

  if (!planes) return error ? <Alerta>{error}</Alerta> : <Spinner />;
  const planValido = nuevoPlan.nombre.trim() && Number(nuevoPlan.precio_mensual) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Plataforma</h1>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <MercadoPagoConexion
        ambito="plataforma"
        titulo="MercadoPago de la plataforma"
        descripcion="Con esta cuenta se cobran las suscripciones de los complejos. Es independiente de las cuentas de cada complejo."
      />

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
