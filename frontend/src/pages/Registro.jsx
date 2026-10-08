import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../api/client';
import { Alerta } from '../components/ui';
import WhatsappInput from '../components/WhatsappInput';
import AuthLayout from '../components/AuthLayout';

/** Registro de compradores (el personal lo crea el administrador del complejo). */
export default function Registro() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [form, setForm] = useState({ nombre: '', email: '', dni: '', password: '', whatsapp: '' });
  const [whatsappOk, setWhatsappOk] = useState(null);
  const [error, setError] = useState('');

  const campo = (k, label, props = {}) => (
    <div>
      <label className="label" htmlFor={`campo-registro-${k}`}>{label}</label>
      <input id={`campo-registro-${k}`} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
    </div>
  );

  const enviar = async (e) => {
    e.preventDefault();
    if (!whatsappOk) return setError('Ingresá un número de WhatsApp válido');
    try {
      await register(form);
      navigate(state?.volver || '/');
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <AuthLayout titulo="Crear cuenta" subtitulo="Comprá entradas y recibilas por WhatsApp." imagen="/landing/boliches.webp" frase="Tu entrada llega al celular. En la puerta, sólo mostrás el QR.">
    <form onSubmit={enviar} className="space-y-4">
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      {campo('nombre', 'Nombre completo', { required: true })}
      {campo('email', 'Email', { type: 'email', required: true })}
      <WhatsappInput value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} onValidez={setWhatsappOk} />
      {campo('dni', 'DNI (opcional)', { inputMode: 'numeric', pattern: '\\d{6,12}' })}
      {campo('password', 'Contraseña', { type: 'password', minLength: 6, required: true })}
      <button className="btn-primary w-full py-2.5!" disabled={!whatsappOk}>Registrarme</button>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">¿Ya tenés cuenta? <Link to="/login" state={state} className="text-indigo-600 dark:text-indigo-400">Ingresá</Link></p>
    </form>
    </AuthLayout>
  );
}
