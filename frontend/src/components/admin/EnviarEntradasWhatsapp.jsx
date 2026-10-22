import { useEffect, useState } from 'react';
import { Check, Copy, WhatsappLogo } from '@phosphor-icons/react';
import { adminApi, mensajeError } from '../../api/client';
import WhatsappInput from '../WhatsappInput';
import { Alerta, Badge, Modal, Spinner } from '../ui';
import { ESTADO_CORREO, textoEntradas, urlWhatsappEntradas } from '../../utils/entradasWhatsapp';

/**
 * El admin envía las entradas de una venta pagada por WhatsApp desde su propio teléfono / WhatsApp Web:
 * carga los links de descarga (uno por ticket), permite corregir el número y abre wa.me con el mensaje armado.
 * El link se abre con un toque del usuario (no window.open tras una espera), así no lo bloquea el navegador.
 */
export default function EnviarEntradasWhatsapp({ idVenta, onClose }) {
  const [venta, setVenta] = useState(null);
  const [telefono, setTelefono] = useState('');
  const [telefonoOk, setTelefonoOk] = useState(null);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    adminApi.entradasVenta(idVenta)
      .then((v) => { setVenta(v); setTelefono(v.whatsapp || ''); })
      .catch((e) => setError(mensajeError(e)));
  }, [idVenta]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoEntradas(venta));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { setError('No se pudo copiar el mensaje'); }
  };

  const url = venta && telefono && telefonoOk !== false ? urlWhatsappEntradas({ ...venta, whatsapp: telefono }) : null;

  return (
    <Modal titulo={`Enviar entradas por WhatsApp · #${idVenta}`} onClose={onClose}>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      {!venta ? (!error && <Spinner />) : (
        <div className="space-y-4" data-testid="enviar-whatsapp">
          <div className="text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">{venta.comprador} {venta.estado_correo && <Badge {...ESTADO_CORREO[venta.estado_correo]} />}</p>
            <p className="text-zinc-500 dark:text-zinc-400">{venta.evento} · {venta.tickets_links.length} entrada{venta.tickets_links.length === 1 ? '' : 's'}{venta.email ? ` · ${venta.email}` : ''}</p>
          </div>
          <WhatsappInput label="WhatsApp del comprador" value={telefono} onChange={setTelefono} onValidez={setTelefonoOk} />
          <div>
            <p className="label">Mensaje</p>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-3 font-sans text-xs text-zinc-700 dark:bg-white/5 dark:text-zinc-300">{textoEntradas(venta)}</pre>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {url ? (
              <a className="btn-primary" href={url} target="_blank" rel="noreferrer" data-testid="abrir-whatsapp"><WhatsappLogo size={18} weight="fill" aria-hidden /> Abrir WhatsApp</a>
            ) : (
              <button type="button" className="btn-primary" disabled>Ingresá un WhatsApp válido</button>
            )}
            <button type="button" className="btn-secondary" onClick={copiar}>
              {copiado ? <Check size={16} weight="bold" className="text-emerald-600" aria-hidden /> : <Copy size={16} weight="bold" aria-hidden />} Copiar mensaje
            </button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Se abre WhatsApp en tu dispositivo con el mensaje listo; revisalo y tocá enviar. Cada link descarga una entrada con su QR.</p>
        </div>
      )}
    </Modal>
  );
}
