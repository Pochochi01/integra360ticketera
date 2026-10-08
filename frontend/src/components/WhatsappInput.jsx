import { useEffect, useId, useState } from 'react';
import { authApi } from '../api/client';
import { Check } from '@phosphor-icons/react';

/** Validación rápida en cliente: dígitos y separadores, de 8 a 15 dígitos. */
export const pareceTelefono = (v) => /^[+\d\s().-]+$/.test(v || '') && (v.match(/\d/g) || []).length >= 8 && (v.match(/\d/g) || []).length <= 15;

/**
 * Campo de WhatsApp con validación en vivo contra el backend (misma regla que al comprar).
 * onValidez(normalizado | null) informa al formulario padre si el número es válido.
 */
export default function WhatsappInput({ value, onChange, onValidez, label = 'WhatsApp', required = true }) {
  const [estado, setEstado] = useState({ valido: null, normalizado: null });
  const id = useId();

  useEffect(() => {
    if (!value) {
      setEstado({ valido: null, normalizado: null });
      onValidez?.(null);
      return;
    }
    if (!pareceTelefono(value)) {
      setEstado({ valido: false, normalizado: null });
      onValidez?.(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await authApi.validarWhatsapp(value);
        setEstado(r);
        onValidez?.(r.valido ? r.normalizado : null);
      } catch {
        setEstado({ valido: null, normalizado: null });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [value]);

  const borde = estado.valido === false ? 'border-rose-400!' : estado.valido ? 'border-emerald-400!' : '';
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={estado.valido === false}
        className={`input ${borde}`}
        type="tel"
        inputMode="tel"
        placeholder="+54 9 11 2345 6789"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      {estado.valido === false && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Ingresá un celular válido con código de área (ej. 11 2345 6789).</p>}
      {estado.valido && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300"><Check size={12} weight="bold" className="mr-1 inline" aria-hidden />Enviaremos tus entradas a {estado.normalizado}</p>}
    </div>
  );
}
