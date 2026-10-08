import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../api/client';
import { Alerta } from '../components/ui';
import AuthLayout from '../components/AuthLayout';

const DESTINO_POR_ROL = { vendedor: '/vendedor', admin: '/admin/eventos', superadmin: '/super/tenants', portero: '/porteria' };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const usuario = await login(form);
      navigate(DESTINO_POR_ROL[usuario.rol] || state?.volver || '/');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <AuthLayout titulo="Ingresar" subtitulo="Accedé a tus entradas o a tu panel." frase="Fiestas, boliches, teatros y restaurantes. Todo con un QR.">
    <form onSubmit={enviar} className="space-y-4">
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <div>
        <label className="label" htmlFor="campo-login-email">Email o usuario</label>
        <input id="campo-login-email" className="input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      </div>
      <div>
        <label className="label" htmlFor="campo-login-contrasena">Contraseña</label>
        <input id="campo-login-contrasena" className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      </div>
      <button className="btn-primary w-full py-2.5!" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">¿No tenés cuenta? <Link to="/registro" state={state} className="text-indigo-600 dark:text-indigo-400">Registrate</Link></p>
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">Vendedores, porteros y administradores ingresan con el usuario que les dio su complejo.</p>
    </form>
    </AuthLayout>
  );
}
