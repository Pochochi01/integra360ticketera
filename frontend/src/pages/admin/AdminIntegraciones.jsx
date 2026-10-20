import { useEffect, useState } from 'react';
import { integracionesApi, mensajeError } from '../../api/client';
import { Alerta } from '../../components/ui';
import MercadoPagoConexion from '../../components/MercadoPagoConexion';
import { ChatCircleDots } from '@phosphor-icons/react';

/** Admin del complejo: cuenta de MercadoPago propia (OAuth) para cobrar entradas + estado del WhatsApp. */
export default function AdminIntegraciones() {
  const [chatbot, setChatbot] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { integracionesApi.estadoChatbot().then(setChatbot).catch((e) => setError(mensajeError(e))); }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Integraciones</h1>
      <Alerta onClose={() => setError('')}>{error}</Alerta>

      <MercadoPagoConexion
        ambito="tenant"
        titulo="MercadoPago"
        descripcion="Las entradas se cobran directamente en la cuenta de MercadoPago de tu complejo. Conectala una vez: el acceso se renueva automáticamente."
      />

      {chatbot && (
        <div className="card space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ChatCircleDots size={22} weight="duotone" className="text-indigo-600 dark:text-indigo-400" aria-hidden /> WhatsApp del complejo</h2>
          <p className="text-sm">
            Proveedor: <b>{chatbot.provider === 'console' ? 'sin configurar (modo prueba)' : chatbot.provider === 'meta' ? 'Meta Business (WhatsApp Cloud)' : 'Baileys (WhatsApp Web)'}</b> · Estado: <b>{chatbot.estado}</b>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">La conexión la gestiona el administrador de la plataforma. Por este canal se envían las entradas y los links de tus vendedores.</p>
        </div>
      )}
    </div>
  );
}
