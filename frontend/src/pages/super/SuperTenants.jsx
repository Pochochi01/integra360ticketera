import { useEffect, useState } from 'react';
import { mensajeError, tenantsApi } from '../../api/client';
import { useTenant } from '../../context/TenantContext';
import { Alerta, Badge, Modal, Spinner } from '../../components/ui';
import { importe, moneda } from '../../utils/format';
import ChatbotModal from './ChatbotModal';
import SuscripcionModal from './SuscripcionModal';
import { ChatCircleDots, Check } from '@phosphor-icons/react';

const VACIO = { nombre: '', slug: '', email_contacto: '', telefono: '', direccion: '', admin: { nombre: '', email: '', password: '' } };

const aSlug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42);

/** Gestión de complejos (tenants) para el superadmin. */
export default function SuperTenants() {
  const { tenant, setTenant } = useTenant();
  const [tenants, setTenants] = useState(null);
  const [form, setForm] = useState(null);
  const [chatbotDe, setChatbotDe] = useState(null);
  const [suscripcionDe, setSuscripcionDe] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => tenantsApi.listar().then(setTenants).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  const guardar = async (e) => {
    e.preventDefault();
    try {
      if (form.id_tenant) {
        const { nombre, slug, email_contacto, telefono, direccion, estado } = form;
        await tenantsApi.actualizar(form.id_tenant, { nombre, slug, email_contacto, telefono, direccion, estado });
      } else {
        await tenantsApi.crear({ ...form, admin: form.admin.email ? form.admin : undefined });
      }
      setForm(null);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const suspender = async (t) => {
    try {
      await tenantsApi.actualizar(t.id_tenant, { estado: t.estado === 'activo' ? 'suspendido' : 'activo' });
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  if (!tenants) return <Spinner />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setAdmin = (k) => (e) => setForm({ ...form, admin: { ...form.admin, [k]: e.target.value } });

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Complejos</h1>
        <button className="btn-primary" onClick={() => setForm(VACIO)}>+ Nuevo complejo</button>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <div className="grid gap-4 md:grid-cols-2">
        {tenants.map((t) => (
          <div key={t.id_tenant} className={`card ${tenant === t.slug ? 'ring-2 ring-indigo-500' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{t.nombre}</h2>
                <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{t.slug}</p>
              </div>
              <Badge estado={t.estado === 'activo' ? 'publicado' : 'cancelado'} texto={t.estado} />
            </div>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t.direccion} {t.email_contacto && `· ${t.email_contacto}`}</p>
            <p className="mt-2 text-sm">{t.eventos} eventos · {t.vendedores} vendedores · {importe(t.recaudado)} recaudado</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Plan: {t.plan || 'sin plan'} {t.suscripcion_estado && `(${t.suscripcion_estado})`} · MercadoPago: {t.mercadopago_activo ? 'activo' : 'no'} ·
              WhatsApp: {t.chatbot_provider ? `${t.chatbot_provider} (${t.chatbot_estado})` : 'sin configurar'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary py-1!" onClick={() => setTenant(t.slug)} disabled={t.estado !== 'activo'}>
                {tenant === t.slug ? <><Check size={14} weight="bold" aria-hidden /> Administrando</> : 'Administrar'}
              </button>
              <button className="btn-secondary py-1!" onClick={() => setForm({ ...t, admin: {} })}>Editar</button>
              <button className="btn-secondary py-1!" onClick={() => setChatbotDe(t)}><ChatCircleDots size={16} weight="bold" aria-hidden /> WhatsApp</button>
              <button className="btn-secondary py-1!" onClick={() => setSuscripcionDe(t)}>Suscripción</button>
              <button className="btn-secondary py-1!" onClick={() => suspender(t)}>{t.estado === 'activo' ? 'Suspender' : 'Reactivar'}</button>
            </div>
          </div>
        ))}
      </div>

      {chatbotDe && <ChatbotModal tenant={chatbotDe} onClose={() => { setChatbotDe(null); cargar(); }} />}
      {suscripcionDe && <SuscripcionModal tenant={suscripcionDe} onClose={() => { setSuscripcionDe(null); cargar(); }} />}

      {form && (
        <Modal titulo={form.id_tenant ? 'Editar complejo' : 'Nuevo complejo'} onClose={() => setForm(null)}>
          <form onSubmit={guardar} className="max-h-[75vh] space-y-3 overflow-y-auto">
            <div>
              <label className="label" htmlFor="campo-supertenants-nombre">Nombre</label>
              <input id="campo-supertenants-nombre" className="input" value={form.nombre} required
                onChange={(e) => setForm({ ...form, nombre: e.target.value, slug: form.id_tenant ? form.slug : aSlug(e.target.value) })} />
            </div>
            <div>
              <label className="label" htmlFor="campo-supertenants-slug-subdominio">Slug (subdominio)</label>
              <input id="campo-supertenants-slug-subdominio" className="input font-mono" value={form.slug} onChange={set('slug')} pattern="[a-z0-9][a-z0-9-]{1,40}[a-z0-9]" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="campo-supertenants-email">Email</label><input id="campo-supertenants-email" className="input" type="email" value={form.email_contacto || ''} onChange={set('email_contacto')} /></div>
              <div><label className="label" htmlFor="campo-supertenants-telefono">Teléfono</label><input id="campo-supertenants-telefono" className="input" value={form.telefono || ''} onChange={set('telefono')} /></div>
            </div>
            <div><label className="label" htmlFor="campo-supertenants-direccion">Dirección</label><input id="campo-supertenants-direccion" className="input" value={form.direccion || ''} onChange={set('direccion')} /></div>
            {!form.id_tenant && (
              <fieldset className="space-y-2 rounded-lg border border-zinc-200 dark:border-white/10 p-3">
                <legend className="px-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">Administrador inicial (opcional)</legend>
                <input className="input" placeholder="Nombre" value={form.admin.nombre} onChange={setAdmin('nombre')} />
                <input className="input" type="email" placeholder="Email" value={form.admin.email} onChange={setAdmin('email')} />
                <input className="input" type="password" placeholder="Contraseña" minLength={6} value={form.admin.password} onChange={setAdmin('password')} />
              </fieldset>
            )}
            <button className="btn-primary w-full">Guardar</button>
          </form>
        </Modal>
      )}
    </>
  );
}
