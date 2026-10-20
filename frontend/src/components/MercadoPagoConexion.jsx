import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowsClockwise, CheckCircle, LinkBreak, PlugsConnected, Wallet, WarningCircle } from '@phosphor-icons/react';
import { integracionesApi, mensajeError } from '../api/client';
import { Alerta, Badge, Skeleton, useConfirmar } from './ui';
import { fecha } from '../utils/format';

/**
 * Conexión con MercadoPago por OAuth, compartida por:
 *   - el panel del complejo  (ambito="tenant")     → cobra las entradas en la cuenta del complejo
 *   - el panel de plataforma (ambito="plataforma") → cobra las suscripciones en la cuenta de la plataforma
 *
 * «Conectar con MercadoPago» pide al backend la URL de autorización y navega a MercadoPago. Al volver,
 * el callback deja ?mp=conectado | ?mp=error&mensaje=… en la URL: se muestra el aviso y se limpia la URL.
 */
const API = {
  tenant: {
    ver: integracionesApi.mercadoPago,
    conectar: integracionesApi.conectarMercadoPago,
    probar: integracionesApi.probarMercadoPago,
    pausar: integracionesApi.pausarMercadoPago,
    desconectar: integracionesApi.eliminarMercadoPago,
  },
  plataforma: {
    ver: integracionesApi.mercadoPagoPlataforma,
    conectar: integracionesApi.conectarMercadoPagoPlataforma,
    probar: integracionesApi.probarMercadoPagoPlataforma,
    desconectar: integracionesApi.eliminarMercadoPagoPlataforma,
  },
};

export default function MercadoPagoConexion({ ambito = 'tenant', titulo, descripcion }) {
  const api = API[ambito];
  const confirmar = useConfirmar();
  const [params, setParams] = useSearchParams();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState('');

  const cargar = useCallback(() => api.ver().then(setDatos).catch((e) => setError(mensajeError(e))), [api]);
  useEffect(() => { cargar(); }, [cargar]);

  // Resultado del callback de OAuth
  useEffect(() => {
    const resultado = params.get('mp');
    if (!resultado) return;
    if (resultado === 'conectado') setAviso(`MercadoPago conectado${params.get('correo') ? ` con ${params.get('correo')}` : ''}.`);
    else setError(params.get('mensaje') || 'No se pudo conectar con MercadoPago.');
    const limpios = new URLSearchParams(params);
    ['mp', 'mensaje', 'correo'].forEach((k) => limpios.delete(k));
    setParams(limpios, { replace: true });
  }, [params, setParams]);

  const accion = async (nombre, fn, exito) => {
    setOcupado(nombre);
    setError('');
    try {
      const r = await fn();
      if (exito) setAviso(typeof exito === 'function' ? exito(r) : exito);
      await cargar();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado('');
    }
  };

  const conectar = async () => {
    setOcupado('conectar');
    setError('');
    try {
      const { url } = await api.conectar();
      window.location.assign(url); // a la pantalla de autorización de MercadoPago
    } catch (e) {
      setError(mensajeError(e));
      setOcupado('');
    }
  };

  const desconectar = async () => {
    const texto = ambito === 'tenant'
      ? 'Los compradores ya no podrán pagar con MercadoPago hasta que vuelvas a conectar una cuenta.'
      : 'No se podrán cobrar suscripciones con MercadoPago hasta que vuelvas a conectar una cuenta.';
    if (!(await confirmar(texto, { titulo: 'Desconectar MercadoPago', aceptar: 'Desconectar', peligro: true }))) return;
    accion('desconectar', api.desconectar, 'Cuenta de MercadoPago desconectada.');
  };

  const c = datos?.conexion;
  const reconectar = c && !c.conectado;

  return (
    <section className="card space-y-4" aria-labelledby={`mp-${ambito}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`mp-${ambito}`} className="flex items-center gap-2 text-lg font-semibold">
          <Wallet size={22} weight="duotone" className="text-sky-600 dark:text-sky-400" aria-hidden /> {titulo}
        </h2>
        {datos && (c
          ? reconectar
            ? <Badge estado="cancelado" texto="Requiere reconexión" />
            : <Badge estado={c.activo ? 'conectado' : 'pendiente'} texto={c.activo ? 'Conectado' : 'Pausado'} />
          : <Badge estado="borrador" texto="Sin conectar" />)}
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{descripcion}</p>

      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      {!datos ? (
        <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-48" /></div>
      ) : (
        <>
          {!datos.app_configurada && (
            <Alerta tipo="info">La conexión con MercadoPago todavía no está habilitada en el servidor. Contactá al administrador de la plataforma.</Alerta>
          )}

          {c && (
            <dl className="grid gap-3 rounded-2xl bg-zinc-50 p-4 text-sm sm:grid-cols-2 dark:bg-white/5">
              <div className="sm:col-span-2">
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">Cuenta vinculada</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 font-medium break-all" data-testid="mp-correo">
                  {reconectar
                    ? <WarningCircle size={16} weight="fill" className="shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
                    : <CheckCircle size={16} weight="fill" className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
                  {c.correo_vinculado || c.nickname || `Usuario ${c.mp_user_id}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">Modo</dt>
                <dd className="mt-0.5">{c.live_mode ? 'Producción' : 'Prueba (sandbox)'}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">Usuario MercadoPago</dt>
                <dd className="mt-0.5 font-mono tabular-nums">{c.mp_user_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">Conectado</dt>
                <dd className="mt-0.5">{fecha(c.conectado_en)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">Acceso válido hasta</dt>
                <dd className="mt-0.5">{fecha(c.expira_en)} <span className="text-xs text-zinc-500 dark:text-zinc-400">(se renueva solo)</span></dd>
              </div>
              {reconectar && c.ultimo_error && (
                <p className="text-xs text-rose-700 sm:col-span-2 dark:text-rose-300">MercadoPago rechazó la renovación: {c.ultimo_error}</p>
              )}
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            {(!c || reconectar) && (
              <button type="button" className="btn bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-60" onClick={conectar}
                disabled={!datos.app_configurada || ocupado === 'conectar'}>
                <PlugsConnected size={18} weight="bold" aria-hidden />
                {ocupado === 'conectar' ? 'Abriendo MercadoPago…' : reconectar ? 'Reconectar con MercadoPago' : 'Conectar con MercadoPago'}
              </button>
            )}
            {c && !reconectar && (
              <button type="button" className="btn-secondary" disabled={ocupado === 'probar'}
                onClick={() => accion('probar', api.probar, (r) => `Conexión OK · ${r.cuenta.email || r.cuenta.nickname || r.cuenta.id}`)}>
                <ArrowsClockwise size={16} weight="bold" aria-hidden /> {ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}
              </button>
            )}
            {c && !reconectar && api.pausar && (
              <button type="button" className="btn-secondary" disabled={ocupado === 'pausar'}
                onClick={() => accion('pausar', () => api.pausar(!c.activo), c.activo ? 'Cobros con MercadoPago pausados.' : 'Cobros con MercadoPago reanudados.')}>
                {c.activo ? 'Pausar cobros' : 'Reanudar cobros'}
              </button>
            )}
            {c && (
              <button type="button" className="btn-secondary text-rose-700! dark:text-rose-300!" onClick={desconectar} disabled={ocupado === 'desconectar'}>
                <LinkBreak size={16} weight="bold" aria-hidden /> Desconectar
              </button>
            )}
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Vas a iniciar sesión en MercadoPago y autorizar a Integra360 a cobrar en tu cuenta. No se guarda tu contraseña: sólo un acceso que podés revocar cuando quieras desde MercadoPago.
          </p>
        </>
      )}
    </section>
  );
}
