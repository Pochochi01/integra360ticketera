import { useEffect, useState } from 'react';
import { mensajeError, suscripcionesApi } from '../../api/client';
import { Alerta, Badge, Modal, Spinner, useConfirmar } from '../../components/ui';
import { fecha, moneda } from '../../utils/format';

/** Plan y cobros de un complejo (superadmin). Los cobros usan la cuenta MercadoPago de la plataforma. */
export default function SuscripcionModal({ tenant, onClose }) {
  const confirmar = useConfirmar();
  const [s, setS] = useState(undefined);
  const [planes, setPlanes] = useState([]);
  const [plan, setPlan] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    Promise.all([suscripcionesApi.deTenant(tenant.id_tenant), suscripcionesApi.planes()])
      .then(([sus, p]) => {
        setS(sus);
        setPlanes(p.filter((x) => x.activo));
        setPlan(sus?.id_plan || '');
      })
      .catch((e) => setError(mensajeError(e)));
  }, []);

  const accion = async (fn, exito) => {
    setError('');
    try {
      const r = await fn();
      if (exito) setAviso(exito);
      return r;
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  return (
    <Modal titulo={`Suscripción · ${tenant.nombre}`} onClose={onClose}>
      {s === undefined ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <Alerta onClose={() => setError('')}>{error}</Alerta>
          <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
          <div className="flex gap-2">
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
              <option value="">Elegir plan…</option>
              {planes.map((p) => <option key={p.id_plan} value={p.id_plan}>{p.nombre} · {moneda(p.precio_mensual)}/mes</option>)}
            </select>
            <button className="btn-primary shrink-0" disabled={!plan || Number(plan) === s?.id_plan}
              onClick={() => accion(async () => setS(await suscripcionesApi.asignar(tenant.id_tenant, Number(plan))), 'Plan asignado')}>Asignar</button>
          </div>
          {s && (
            <>
              <p>
                Estado <Badge estado={s.estado_actual === 'activa' ? 'pagado' : s.estado_actual === 'vencida' ? 'cancelado' : 'pendiente'} /> ·
                {s.vence_el ? ` vence el ${fecha(s.vence_el)}` : ' sin pagos'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => accion(async () => setLink((await suscripcionesApi.cobrar(tenant.id_tenant)).url), 'Link de pago generado')}>Generar link de pago (MP)</button>
                <button className="btn-secondary" onClick={async () => (await confirmar('Se extiende la suscripción un mes sin cobrar por MercadoPago.', { titulo: 'Registrar pago manual', aceptar: 'Registrar mes' })) && accion(async () => setS(await suscripcionesApi.registrarPago(tenant.id_tenant, 'Pago registrado manualmente')), 'Mes registrado')}>Registrar pago manual</button>
              </div>
              {link && <p className="break-all rounded-lg bg-zinc-50 dark:bg-white/5 p-2 font-mono text-xs"><a className="text-indigo-600 dark:text-indigo-400 underline" href={link} target="_blank" rel="noreferrer">{link}</a></p>}
              <div>
                <h4 className="mb-1 font-semibold">Pagos</h4>
                {s.pagos.map((p) => (
                  <div key={p.id_pago} className="flex justify-between border-b border-zinc-100 dark:border-white/5 py-1">
                    <span>{fecha(p.creado_en)} · {p.proveedor}</span>
                    <span className="flex items-center gap-2">{moneda(p.monto)} <Badge estado={p.estado === 'aprobado' ? 'pagado' : p.estado} /></span>
                  </div>
                ))}
                {s.pagos.length === 0 && <p className="text-zinc-400 dark:text-zinc-500">Sin pagos</p>}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
