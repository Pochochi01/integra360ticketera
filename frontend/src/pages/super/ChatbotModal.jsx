import { useEffect, useRef, useState } from 'react';
import { integracionesApi, mensajeError } from '../../api/client';
import { Alerta, Modal, Spinner, useConfirmar } from '../../components/ui';
import WhatsappInput from '../../components/WhatsappInput';

const META_VACIO = { phone_number_id: '', access_token: '', template: '', idioma: 'es_AR' };

/**
 * Configuración del chatbot de WhatsApp de un complejo (exclusivo del superadmin).
 *  - Meta Business: phone number ID + token (verificados contra la Graph API) + plantilla opcional.
 *  - Baileys: vinculación escaneando un QR con el WhatsApp del complejo.
 */
export default function ChatbotModal({ tenant, onClose }) {
  const confirmar = useConfirmar();
  const [actual, setActual] = useState(undefined);
  const [provider, setProvider] = useState('meta');
  const [meta, setMeta] = useState(META_VACIO);
  const [baileys, setBaileys] = useState({ estado: 'desconectado', qr: null });
  const [prueba, setPrueba] = useState('');
  const [pruebaOk, setPruebaOk] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const poll = useRef(null);

  const cargar = async () => {
    const c = await integracionesApi.chatbot(tenant.id_tenant);
    setActual(c);
    if (c) {
      setProvider(c.provider);
      if (c.provider === 'meta') setMeta({ ...META_VACIO, ...c.credentials, access_token: '' });
      else setBaileys({ estado: c.estado, qr: c.qr });
    }
  };
  useEffect(() => {
    cargar().catch((e) => setError(mensajeError(e)));
    return () => clearInterval(poll.current);
  }, []);

  // Mientras Baileys espera el escaneo, se consulta el estado y el QR (que rota cada ~20 s)
  const seguirBaileys = () => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const e = await integracionesApi.estadoBaileys(tenant.id_tenant).catch(() => null);
      if (!e) return;
      setBaileys(e);
      if (['conectado', 'desconectado'].includes(e.estado)) clearInterval(poll.current);
    }, 2000);
  };

  const accion = async (fn, exito) => {
    setError('');
    setOcupado(true);
    try {
      const r = await fn();
      if (exito) setAviso(exito);
      return r;
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };

  const metaValido = /^\d{5,20}$/.test(meta.phone_number_id) && (meta.access_token || actual?.provider === 'meta') && (!meta.template || /^[a-z0-9_]+$/.test(meta.template));

  const guardarMeta = (e) => {
    e.preventDefault();
    accion(async () => {
      await integracionesApi.guardarChatbot(tenant.id_tenant, { provider: 'meta', credentials: meta });
      await cargar();
    }, 'Meta Business verificado y guardado');
  };

  const usarBaileys = () =>
    accion(async () => {
      await integracionesApi.guardarChatbot(tenant.id_tenant, { provider: 'baileys' });
      await cargar();
    }, 'Proveedor Baileys seleccionado: vinculá el teléfono');

  const conectar = () =>
    accion(async () => {
      setBaileys(await integracionesApi.conectarBaileys(tenant.id_tenant));
      seguirBaileys();
    });

  const desconectar = () =>
    accion(async () => {
      clearInterval(poll.current);
      setBaileys(await integracionesApi.desconectarBaileys(tenant.id_tenant));
    }, 'Sesión de WhatsApp cerrada');

  const quitar = async () => {
    if (!(await confirmar('El complejo deja de enviar entradas y links por WhatsApp.', { titulo: 'Quitar chatbot', aceptar: 'Quitar', peligro: true }))) return;
    accion(async () => {
      await integracionesApi.eliminarChatbot(tenant.id_tenant);
      setActual(null);
      setMeta(META_VACIO);
      setBaileys({ estado: 'desconectado', qr: null });
    }, 'Chatbot eliminado');
  };

  const enviarPrueba = (e) => {
    e.preventDefault();
    accion(() => integracionesApi.probarChatbot(tenant.id_tenant, prueba), 'Mensaje de prueba enviado');
  };

  const setM = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });

  return (
    <Modal titulo={`WhatsApp · ${tenant.nombre}`} onClose={onClose}>
      {actual === undefined ? <Spinner /> : (
        <div className="max-h-[75vh] space-y-4 overflow-y-auto text-sm">
          <Alerta onClose={() => setError('')}>{error}</Alerta>
          <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {[['meta', 'Meta Business API', 'WhatsApp Cloud oficial'], ['baileys', 'Baileys', 'WhatsApp Web (QR)']].map(([v, t, d]) => (
              <button key={v} type="button" role="radio" aria-checked={provider === v} onClick={() => setProvider(v)}
                className={`rounded-lg border p-3 text-left ${provider === v ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-zinc-200 dark:border-white/10'}`}>
                <b>{t}</b><div className="text-xs text-zinc-500 dark:text-zinc-400">{d}</div>
              </button>
            ))}
          </div>

          {provider === 'meta' && (
            <form onSubmit={guardarMeta} className="space-y-3">
              <div><label className="label" htmlFor="campo-chatbotmodal-phone-number-id">Phone number ID</label><input id="campo-chatbotmodal-phone-number-id" className="input font-mono" inputMode="numeric" value={meta.phone_number_id} onChange={setM('phone_number_id')} /></div>
              <div>
                <label className="label" htmlFor="campo-meta-access-token">Access token {actual?.provider === 'meta' && `(guardado: ${actual.credentials.access_token}; vacío = conservar)`}</label>
                <input id="campo-meta-access-token" className="input font-mono" type="password" autoComplete="off" value={meta.access_token} onChange={setM('access_token')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label" htmlFor="campo-chatbotmodal-plantilla-opcional">Plantilla (opcional)</label><input id="campo-chatbotmodal-plantilla-opcional" className="input font-mono" placeholder="entrada_link" value={meta.template || ''} onChange={setM('template')} /></div>
                <div><label className="label" htmlFor="campo-chatbotmodal-idioma">Idioma</label><input id="campo-chatbotmodal-idioma" className="input" value={meta.idioma} onChange={setM('idioma')} /></div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Sin plantilla se envía texto libre (sólo válido dentro de las 24 h de conversación). Con plantilla, el link va como parámetro {'{{1}}'}.</p>
              <button className="btn-primary w-full" disabled={!metaValido || ocupado}>{ocupado ? 'Verificando…' : 'Verificar y guardar'}</button>
            </form>
          )}

          {provider === 'baileys' && (
            <div className="space-y-3">
              {actual?.provider !== 'baileys' ? (
                <button className="btn-primary w-full" onClick={usarBaileys} disabled={ocupado}>Usar Baileys para este complejo</button>
              ) : (
                <>
                  <p>Estado: <b data-testid="estado-baileys">{baileys.estado}</b></p>
                  {baileys.estado === 'en_otra_instancia' && <p className="text-xs text-amber-700 dark:text-amber-300">La sesión la tiene otra instancia del servidor; ésta la tomará sola si aquella se detiene.</p>}
                  {actual.ultimo_error && baileys.estado !== 'conectado' && <p className="text-xs text-rose-700 dark:text-rose-300">Último evento: {actual.ultimo_error}</p>}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Errores de descifrado recuperados: {actual.errores_descifrado ?? 0} · Sesiones regeneradas: {actual.regeneraciones ?? 0}</p>
                  {baileys.qr && (
                    <div className="text-center">
                      <img src={baileys.qr} alt="QR de vinculación de WhatsApp" className="mx-auto w-56" />
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">En el teléfono del complejo: WhatsApp → Dispositivos vinculados → Vincular dispositivo.</p>
                    </div>
                  )}
                  {['conectando', 'esperando_qr'].includes(baileys.estado) && !baileys.qr && <Spinner />}
                  <div className="flex gap-2">
                    {['desconectado', 'error'].includes(baileys.estado) && <button className="btn-primary flex-1" onClick={conectar} disabled={ocupado}>Vincular / mostrar QR</button>}
                    {!['desconectado', 'error'].includes(baileys.estado) && <button className="btn-secondary flex-1" onClick={desconectar} disabled={ocupado}>Desvincular</button>}
                  </div>
                </>
              )}
            </div>
          )}

          {actual && (
            <form onSubmit={enviarPrueba} className="space-y-2 border-t border-zinc-100 dark:border-white/5 pt-3">
              <WhatsappInput label="Enviar mensaje de prueba a" value={prueba} onChange={setPrueba} onValidez={setPruebaOk} />
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" disabled={!pruebaOk || ocupado}>Enviar prueba</button>
                <button type="button" className="btn-secondary text-rose-600 dark:text-rose-400" onClick={quitar}>Quitar chatbot</button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
