import { useEffect, useState } from 'react';
import { integracionesApi, mensajeError } from '../../api/client';
import { Alerta, Badge, Spinner, useConfirmar } from '../../components/ui';
import { fecha } from '../../utils/format';
import { ChatCircleDots, Wallet } from '@phosphor-icons/react';

const VACIO = { access_token: '', public_key: '', collector_id: '', webhook_secret: '', modo: 'prueba', activo: true };
const TOKEN_RE = /^(APP_USR|TEST)-[\w-]{10,}$/;

/** Admin del complejo: cuenta de MercadoPago propia para cobrar tickets + estado del WhatsApp. */
export default function AdminIntegraciones() {
  const confirmar = useConfirmar();
  const [datos, setDatos] = useState(null);
  const [chatbot, setChatbot] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = async () => {
    try {
      const [mp, cb] = await Promise.all([integracionesApi.mercadoPago(), integracionesApi.estadoChatbot()]);
      setDatos(mp);
      setChatbot(cb);
      const i = mp.integracion;
      setForm(i ? { ...VACIO, public_key: i.public_key, collector_id: i.collector_id || '', modo: i.modo, activo: i.activo } : VACIO);
    } catch (e) {
      setError(mensajeError(e));
    }
  };
  useEffect(() => { cargar(); }, []);

  const existente = datos?.integracion;
  // Validación en el formulario (misma regla que el backend)
  const errores = {
    access_token: !existente && !form.access_token ? 'Obligatorio' : form.access_token && !TOKEN_RE.test(form.access_token) ? 'Debe empezar con APP_USR- o TEST-' : null,
    public_key: !TOKEN_RE.test(form.public_key || 'x') && !/^(APP_USR|TEST)-[\w-]{8,}$/.test(form.public_key) ? 'Debe empezar con APP_USR- o TEST-' : null,
    collector_id: form.collector_id && !/^\d{3,20}$/.test(form.collector_id) ? 'Sólo números' : null,
  };
  const valido = !Object.values(errores).some(Boolean);

  const guardar = async (e) => {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true);
    setError('');
    try {
      const r = await integracionesApi.guardarMercadoPago({ ...form, access_token: form.access_token || undefined, webhook_secret: form.webhook_secret || undefined });
      await cargar();
      setAviso(`Credenciales verificadas y guardadas (cuenta ${r.cuenta.nickname || r.cuenta.id})`);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const probar = async () => {
    try {
      const r = await integracionesApi.probarMercadoPago();
      setAviso(`Conexión OK · cuenta ${r.cuenta.nickname || r.cuenta.id}`);
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const eliminar = async () => {
    if (!(await confirmar('Los compradores ya no podrán pagar con MercadoPago en tu complejo.', { titulo: 'Quitar MercadoPago', aceptar: 'Quitar cuenta', peligro: true }))) return;
    await integracionesApi.eliminarMercadoPago();
    setAviso('Cuenta de MercadoPago eliminada');
    cargar();
  };

  if (!datos) return error ? <Alerta>{error}</Alerta> : <Spinner />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const campoError = (k) => errores[k] && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{errores[k]}</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Integraciones</h1>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <form onSubmit={guardar} className="card space-y-4" noValidate>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet size={22} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden /> MercadoPago</h2>
          {existente ? <Badge estado={existente.activo ? 'publicado' : 'cancelado'} texto={existente.activo ? 'Activa' : 'Inactiva'} /> : <span className="text-sm text-zinc-400 dark:text-zinc-500">Sin configurar</span>}
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Las entradas se cobran directamente en la cuenta de tu complejo. Obtené las credenciales en
          {' '}<a className="text-indigo-600 dark:text-indigo-400 underline" href="https://www.mercadopago.com.ar/developers/panel/app" target="_blank" rel="noreferrer">Tus integraciones → Credenciales</a>.
        </p>
        {existente && (
          <p className="rounded-lg bg-zinc-50 dark:bg-white/5 p-3 text-xs text-zinc-600 dark:text-zinc-400">
            Token guardado: <span className="font-mono">{existente.access_token}</span> · Collector ID {existente.collector_id} · actualizado {fecha(existente.actualizado_en)}
          </p>
        )}
        <div>
          <label className="label" htmlFor="campo-mp-access-token">Access token {existente && '(dejar vacío para conservar el actual)'}</label>
          <input id="campo-mp-access-token" className="input font-mono" type="password" autoComplete="off" value={form.access_token} onChange={set('access_token')} placeholder="APP_USR-…" />
          {campoError('access_token')}
        </div>
        <div>
          <label className="label" htmlFor="campo-adminintegraciones-public-key">Public key</label>
          <input id="campo-adminintegraciones-public-key" className="input font-mono" value={form.public_key} onChange={set('public_key')} placeholder="APP_USR-…" />
          {campoError('public_key')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="campo-adminintegraciones-collector-id-opcional">Collector ID (opcional)</label>
            <input id="campo-adminintegraciones-collector-id-opcional" className="input" inputMode="numeric" value={form.collector_id} onChange={set('collector_id')} placeholder="Se completa solo" />
            {campoError('collector_id')}
          </div>
          <div>
            <label className="label" htmlFor="campo-adminintegraciones-modo">Modo</label>
            <select id="campo-adminintegraciones-modo" className="input" value={form.modo} onChange={set('modo')}>
              <option value="prueba">Prueba (sandbox)</option>
              <option value="produccion">Producción</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="campo-adminintegraciones-clave-secreta-de-webhooks-opcional-recom">Clave secreta de webhooks (opcional, recomendada)</label>
          <input id="campo-adminintegraciones-clave-secreta-de-webhooks-opcional-recom" className="input font-mono" type="password" autoComplete="off" value={form.webhook_secret} onChange={set('webhook_secret')}
            placeholder={existente?.webhook_secret_configurado ? '•••••• (configurada)' : ''} />
        </div>
        <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 p-3 text-xs text-indigo-900 dark:text-indigo-100">
          URL de notificaciones (Webhooks → Pagos): <span className="break-all font-mono">{datos.webhook_url}</span>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activo} onChange={set('activo')} /> Ofrecer MercadoPago a los compradores</label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!valido || enviando}>{enviando ? 'Verificando…' : 'Verificar y guardar'}</button>
          {existente && <button type="button" className="btn-secondary" onClick={probar}>Probar conexión</button>}
          {existente && <button type="button" className="btn-secondary text-rose-600 dark:text-rose-400" onClick={eliminar}>Quitar</button>}
        </div>
      </form>

      <div className="card space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ChatCircleDots size={22} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden /> WhatsApp del complejo</h2>
        <p className="text-sm">
          Proveedor: <b>{chatbot.provider === 'console' ? 'sin configurar (modo prueba)' : chatbot.provider === 'meta' ? 'Meta Business (WhatsApp Cloud)' : 'Baileys (WhatsApp Web)'}</b> · Estado: <b>{chatbot.estado}</b>
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">La conexión la gestiona el administrador de la plataforma. Por este canal se envían las entradas y los links de tus vendedores.</p>
      </div>
    </div>
  );
}
