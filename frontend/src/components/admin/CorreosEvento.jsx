import { useEffect, useState } from 'react';
import { ArrowClockwise, Check, Copy, EnvelopeSimple, WhatsappLogo } from '@phosphor-icons/react';
import { adminApi, mensajeError } from '../../api/client';
import { Alerta, Badge } from '../ui';
import { fecha, moneda } from '../../utils/format';
import { ESTADO_CORREO, textoEntradas, urlWhatsappEntradas } from '../../utils/entradasWhatsapp';

/**
 * Correos con las entradas de un evento (admin): por cada venta pagada, si el correo salió, el motivo si falló,
 * reenviar, y — si no llegó — abrir WhatsApp del comprador con los links de cada ticket o copiarlos.
 */
export default function CorreosEvento({ evento }) {
  const [ventas, setVentas] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(null);
  const [copiado, setCopiado] = useState(null);

  const cargar = () => adminApi.correosEvento(evento.id_evento).then(setVentas).catch((e) => setError(mensajeError(e)));
  useEffect(() => { setVentas(null); cargar(); }, [evento.id_evento]);

  const reenviar = async (v) => {
    setEnviando(v.id_venta);
    setError('');
    try {
      const r = await adminApi.reenviarCorreo(v.id_venta);
      if (r.estado === 'sent') setAviso(`Correo reenviado a ${r.destino}`);
      else setError(`No se pudo enviar: ${r.motivo}. Podés mandar los links por WhatsApp.`);
      await cargar();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(null);
    }
  };

  const copiar = async (v) => {
    try {
      await navigator.clipboard.writeText(textoEntradas(v, evento.nombre));
      setCopiado(v.id_venta);
      setTimeout(() => setCopiado(null), 1500);
    } catch { setError('No se pudo copiar: copiá los links desde el detalle'); }
  };

  // Si el endpoint falla (ej. migración 016 sin aplicar en el servidor) se muestra el error: no desaparece la sección
  if (!ventas) {
    return error ? (
      <section aria-labelledby="titulo-correos" data-testid="correos-evento">
        <h3 id="titulo-correos" className="mb-2 flex items-center gap-2 font-semibold">
          <EnvelopeSimple size={18} weight="duotone" className="text-zinc-500" aria-hidden /> Correos de entradas
        </h3>
        <Alerta>{`No se pudo cargar el estado de los correos: ${error}`}</Alerta>
        <button type="button" className="btn-secondary py-1!" onClick={() => { setError(''); cargar(); }}>Reintentar</button>
      </section>
    ) : null;
  }
  const fallidos = ventas.filter((v) => v.estado_correo === 'failed').length;
  const visibles = filtro ? ventas.filter((v) => (filtro === 'sin' ? !v.estado_correo : v.estado_correo === filtro)) : ventas;

  return (
    <section aria-labelledby="titulo-correos" data-testid="correos-evento">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="titulo-correos" className="flex items-center gap-2 font-semibold">
          <EnvelopeSimple size={18} weight="duotone" className="text-zinc-500" aria-hidden /> Correos de entradas
          {fallidos > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-400/10 dark:text-rose-300">{fallidos} fallido{fallidos === 1 ? '' : 's'}</span>}
        </h3>
        <select className="input w-full! py-1! sm:w-auto!" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por estado del correo">
          <option value="">Todos ({ventas.length})</option>
          <option value="failed">Fallidos</option>
          <option value="sent">Enviados</option>
          <option value="sin">Sin enviar</option>
        </select>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
      {visibles.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{ventas.length ? 'No hay ventas con ese estado.' : 'Todavía no hay ventas pagadas.'}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {visibles.map((v) => {
            const wa = urlWhatsappEntradas(v, evento.nombre);
            const estado = ESTADO_CORREO[v.estado_correo] || { texto: 'Sin enviar', estado: 'borrador' };
            return (
              <li key={v.id_venta} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`correo-venta-${v.id_venta}`}>
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">#{v.id_venta} · {v.comprador} <Badge {...estado} /></p>
                  <p className="truncate text-zinc-500 dark:text-zinc-400">{v.email || 'sin email'} · {v.tickets_links.length} entrada{v.tickets_links.length === 1 ? '' : 's'} · {moneda(v.monto_total)}{v.vendedor && ` · vendió ${v.vendedor}`}</p>
                  {v.estado_correo === 'failed' && v.correo_error && <p className="text-xs text-rose-700 dark:text-rose-300">{v.correo_error}</p>}
                  {v.correo_enviado_en && <p className="text-xs text-zinc-400 dark:text-zinc-500">Último intento {fecha(v.correo_enviado_en)}</p>}
                </div>
                <div className="grid min-w-0 shrink-0 grid-cols-3 gap-2 sm:flex *:min-w-0 *:px-2 sm:*:px-4">
                  <button className="btn-secondary py-1!" onClick={() => reenviar(v)} disabled={enviando === v.id_venta || !v.email}>
                    <ArrowClockwise size={14} weight="bold" className={enviando === v.id_venta ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden /> Reenviar
                  </button>
                  {wa ? (
                    <a className="btn-secondary py-1! text-emerald-700 dark:text-emerald-400" href={wa} target="_blank" rel="noreferrer" aria-label={`Enviar las entradas por WhatsApp a ${v.comprador}`} data-testid="whatsapp-entradas">
                      <WhatsappLogo size={16} weight="fill" className="hidden shrink-0 min-[400px]:inline" aria-hidden /> WhatsApp
                    </a>
                  ) : <span className="btn-secondary py-1! opacity-50" aria-disabled="true">Sin WhatsApp</span>}
                  <button className="btn-secondary py-1!" onClick={() => copiar(v)} aria-label={`Copiar los links de las entradas de ${v.comprador}`}>
                    {copiado === v.id_venta ? <Check size={16} weight="bold" className="text-emerald-600" aria-hidden /> : <Copy size={16} weight="bold" aria-hidden />} Links
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
