import { useEffect, useState } from 'react';
import { mensajeError, suscripcionesApi, tenantsApi } from '../../api/client';
import { Alerta, Badge, Spinner } from '../../components/ui';
import { fecha, moneda } from '../../utils/format';

/** Estado de la suscripción del complejo a la plataforma y pago con MercadoPago. */
function MiSuscripcion() {
  const [s, setS] = useState(undefined);
  const [error, setError] = useState('');
  const [pagando, setPagando] = useState(false);
  useEffect(() => { suscripcionesApi.mia().then(setS).catch((e) => setError(mensajeError(e))); }, []);

  const pagar = async () => {
    setPagando(true);
    try {
      const r = await suscripcionesApi.pagarMia();
      window.location.assign(r.url);
    } catch (e) {
      setError(mensajeError(e));
      setPagando(false);
    }
  };

  if (s === undefined) return error ? <Alerta>{error}</Alerta> : null;
  return (
    <div className="card space-y-2" data-testid="suscripcion">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Suscripción a Integra360</h2>
        {s && <Badge estado={s.estado_actual === 'activa' ? 'pagado' : s.estado_actual === 'vencida' ? 'cancelado' : 'pendiente'} />}
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      {!s ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Tu complejo todavía no tiene un plan asignado. Contactá al administrador de la plataforma.</p>
      ) : (
        <>
          <p className="text-sm">Plan <b>{s.plan}</b> · {moneda(s.precio_mensual)} por mes · {s.vence_el ? <>vence el <b>{fecha(s.vence_el)}</b></> : 'sin pagos registrados'}</p>
          {s.estado_actual !== 'cancelada' && (
            <button type="button" className="btn-primary" onClick={pagar} disabled={pagando}>{pagando ? 'Redirigiendo…' : 'Pagar un mes con MercadoPago'}</button>
          )}
        </>
      )}
    </div>
  );
}

const PLANTILLA_AYUDA = 'Variables: {nombre} {tenant} {evento} {fecha} {cantidad} {link}';

/** Datos de contacto y configuración del complejo (admin del tenant). */
export default function AdminComplejo() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    tenantsApi.mio().then((t) => setForm({ ...t, config: t.config || {} })).catch((e) => setError(mensajeError(e)));
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    try {
      const t = await tenantsApi.actualizarMio({
        nombre: form.nombre, email_contacto: form.email_contacto, telefono: form.telefono, direccion: form.direccion,
        config: { mensaje_whatsapp: form.config.mensaje_whatsapp || null, color_primario: form.config.color_primario || null },
      });
      setForm({ ...t, config: t.config || {} });
      setAviso('Datos guardados');
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  if (!form) return error ? <Alerta>{error}</Alerta> : <Spinner />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setConfig = (k) => (e) => setForm({ ...form, config: { ...form.config, [k]: e.target.value } });
  const linkPublico = `${window.location.origin}/eventos?complejo=${form.slug}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
    <h1 className="text-3xl font-semibold tracking-tight">Mi complejo</h1>
    <MiSuscripcion />
    <form onSubmit={guardar} className="space-y-4">
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
      <div className="card space-y-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Identificador: <b className="font-mono">{form.slug}</b> · Página pública: <a className="text-indigo-600 dark:text-indigo-400 underline" href={linkPublico}>{linkPublico}</a>
        </p>
        <div><label className="label" htmlFor="campo-admincomplejo-nombre">Nombre</label><input id="campo-admincomplejo-nombre" className="input" value={form.nombre} onChange={set('nombre')} required /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="campo-admincomplejo-email-de-contacto">Email de contacto</label><input id="campo-admincomplejo-email-de-contacto" className="input" type="email" value={form.email_contacto || ''} onChange={set('email_contacto')} /></div>
          <div><label className="label" htmlFor="campo-admincomplejo-telefono">Teléfono</label><input id="campo-admincomplejo-telefono" className="input" value={form.telefono || ''} onChange={set('telefono')} /></div>
        </div>
        <div><label className="label" htmlFor="campo-admincomplejo-direccion">Dirección</label><input id="campo-admincomplejo-direccion" className="input" value={form.direccion || ''} onChange={set('direccion')} /></div>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Mensaje de WhatsApp al comprador</h2>
        <textarea
          className="input min-h-32 font-mono"
          placeholder="Vacío = mensaje por defecto"
          value={form.config.mensaje_whatsapp || ''}
          onChange={setConfig('mensaje_whatsapp')}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{PLANTILLA_AYUDA}. Incluí siempre <code>{'{link}'}</code>: es el acceso a las entradas.</p>
        <div className="flex items-center gap-3">
          <label className="label mb-0!">Color de marca</label>
          <input type="color" value={form.config.color_primario || '#4f46e5'} onChange={setConfig('color_primario')} />
        </div>
      </div>
      <button className="btn-primary">Guardar cambios</button>
    </form>
    </div>
  );
}
