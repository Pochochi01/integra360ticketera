import { useEffect, useState } from 'react';
import { mensajeError, tenantsApi, usuariosApi } from '../../api/client';
import { Alerta, Modal, Spinner } from '../../components/ui';
import { fecha } from '../../utils/format';

const VACIO = { nombre: '', email: '', password: '', rol: 'admin', id_tenant: '' };

/** Usuarios de la plataforma (superadmin). Los vendedores se gestionan desde cada complejo. */
export default function SuperUsuarios() {
  const [usuarios, setUsuarios] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [filtroRol, setFiltroRol] = useState('');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => usuariosApi.listar().then(setUsuarios).catch((e) => setError(mensajeError(e)));
  useEffect(() => {
    cargar();
    tenantsApi.listar().then(setTenants).catch(() => {});
  }, []);

  const actualizar = async (u, cambios) => {
    try { await usuariosApi.actualizar(u.id_usuario, cambios); cargar(); } catch (e) { setError(mensajeError(e)); }
  };

  const crear = async (e) => {
    e.preventDefault();
    try {
      await usuariosApi.crear({ ...form, id_tenant: form.id_tenant ? Number(form.id_tenant) : null });
      setForm(null);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  if (!usuarios) return <Spinner />;
  const lista = usuarios.filter((u) => !filtroRol || u.rol === filtroRol);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Usuarios</h1>
        <div className="flex gap-2">
          <select className="input w-auto!" value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)}>
            <option value="">Todos los roles</option>
            {['superadmin', 'admin', 'vendedor', 'comprador'].map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="btn-primary shrink-0" onClick={() => setForm(VACIO)}>+ Usuario</button>
        </div>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <div className="card overflow-x-auto p-0!">
        <table className="tabla">
          <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
            <tr><th className="p-3">Nombre</th><th className="p-3">Email</th><th className="p-3">WhatsApp</th><th className="p-3">Alta</th><th className="p-3">Rol</th><th className="p-3">Complejo</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {lista.map((u) => (
              <tr key={u.id_usuario}>
                <td className="p-3">{u.nombre}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">{u.whatsapp || '-'}</td>
                <td className="p-3">{fecha(u.creado_en)}</td>
                <td className="p-3">
                  {u.rol === 'vendedor' ? 'vendedor' : (
                    <select className="input w-32! py-1!" value={u.rol} onChange={(e) => actualizar(u, { rol: e.target.value, id_tenant: u.id_tenant || tenants[0]?.id_tenant })}>
                      {['comprador', 'admin', 'superadmin'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td className="p-3">
                  {u.rol === 'admin' ? (
                    <select className="input w-40! py-1!" value={u.id_tenant || ''} onChange={(e) => actualizar(u, { id_tenant: Number(e.target.value) })}>
                      {tenants.map((t) => <option key={t.id_tenant} value={t.id_tenant}>{t.nombre}</option>)}
                    </select>
                  ) : u.tenant || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo="Nuevo usuario" onClose={() => setForm(null)}>
          <form onSubmit={crear} className="space-y-3">
            <input className="input" placeholder="Nombre" value={form.nombre} onChange={set('nombre')} required />
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
            <input className="input" type="password" placeholder="Contraseña" minLength={6} value={form.password} onChange={set('password')} required />
            <select className="input" value={form.rol} onChange={set('rol')}>
              <option value="admin">Administrador de complejo</option>
              <option value="superadmin">Superadmin</option>
            </select>
            {form.rol === 'admin' && (
              <select className="input" value={form.id_tenant} onChange={set('id_tenant')} required>
                <option value="">Complejo…</option>
                {tenants.map((t) => <option key={t.id_tenant} value={t.id_tenant}>{t.nombre}</option>)}
              </select>
            )}
            <button className="btn-primary w-full">Crear</button>
          </form>
        </Modal>
      )}
    </>
  );
}
