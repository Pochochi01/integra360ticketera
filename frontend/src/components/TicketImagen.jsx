import { useEffect, useState } from 'react';
import { mensajeError, ticketsApi } from '../api/client';
import { Spinner } from './ui';
import { DownloadSimple } from '@phosphor-icons/react';

/** Entrada compuesta por el servidor (imagen del evento + QR). Se pide con JWT y se muestra como blob. */
export default function TicketImagen({ idTicket }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let creada;
    ticketsApi
      .imagen(idTicket)
      .then((u) => setUrl((creada = u)))
      .catch((e) => setError(mensajeError(e)));
    return () => creada && URL.revokeObjectURL(creada);
  }, [idTicket]);

  if (error) return <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>;
  if (!url) return <Spinner />;
  return (
    <div className="space-y-3">
      <img src={url} alt="Entrada con código QR" className="mx-auto w-full max-w-xs rounded-lg border border-zinc-200 dark:border-white/10" />
      <a className="btn-secondary w-full" href={url} download={`entrada-${idTicket}.png`}><DownloadSimple size={16} weight="bold" aria-hidden /> Descargar entrada</a>
    </div>
  );
}
