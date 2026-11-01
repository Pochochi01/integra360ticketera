import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle, Copy, DownloadSimple, FilePdf, Minus, Money, Plus, QrCode, ShareNetwork, Wallet, XCircle } from '@phosphor-icons/react';
import { adminApi, eventosApi, mensajeError } from '../../../api/client';
import WhatsappInput from '../../WhatsappInput';
import { Alerta, Skeleton, Vacio } from '../../ui';
import { fecha, importe, moneda } from '../../../utils/format';
import { eventoPorDefecto } from './ControlIngresos';

/**
 * Venta en portería (/admin/porteros/venta):
 *  1. QR de compra del evento (general y uno por tipo) para imprimir en la puerta: PNG, PDF (cartel A4),
 *     copiar y compartir. El cliente lo escanea, compra en /comprar/... y paga con MercadoPago.
 *  2. Cobro asistido en boletería: el staff elige tipo, cantidad y método de pago.
 *     · Mercado Pago QR: genera el cobro y muestra el QR; el cliente paga desde su celular y esta pantalla
 *       confirma sola (consulta el estado cada 2 s).
 *     · Efectivo: registra la venta al instante (sin Mercado Pago) y muestra las entradas habilitadas.
 *     Cada operación lleva una clave única: un doble click o un reintento no registra dos ventas.
 * Los QR se generan en el navegador (librería qrcode, ya instalada); jsPDF se carga sólo al pedir el PDF.
 */
const SONDEO_MS = 2000;
/** Clave de idempotencia de una operación (una por venta: se renueva al empezar otra). */
const nuevaClave = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, '0').slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

const archivoDe = (texto) => String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

const qrPng = (url, ancho = 1024) => QRCode.toDataURL(url, { width: ancho, margin: 2, errorCorrectionLevel: 'M' });

const descargarPng = async (url, nombre) => {
  const a = document.createElement('a');
  a.href = await qrPng(url);
  a.download = `qr-${archivoDe(nombre)}.png`;
  a.click();
};

/** Cartel A4 para imprimir: título, evento, QR grande y la URL escrita (por si la cámara falla). */
const descargarPdf = async ({ url, evento, tipo }) => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const centro = 105;
  doc.setFont('helvetica', 'bold').setFontSize(30).text('Comprá tu entrada', centro, 32, { align: 'center' });
  doc.setFont('helvetica', 'normal').setFontSize(18).text(doc.splitTextToSize(evento.nombre, 170), centro, 46, { align: 'center' });
  doc.setFontSize(12).setTextColor(90).text(`${fecha(evento.fecha)}${evento.lugar ? ` · ${evento.lugar}` : ''}`, centro, 58, { align: 'center' });
  if (tipo) doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(79, 70, 229).text(`${tipo.nombre} · ${moneda(tipo.precio)}`, centro, 72, { align: 'center' });
  // 600 px a 12 cm ≈ 127 dpi: sobra para un QR (blanco y negro) y el PDF queda liviano
  doc.addImage(await qrPng(url, 600), 'PNG', 45, 80, 120, 120, undefined, 'FAST');
  doc.setFont('helvetica', 'normal').setTextColor(40).setFontSize(13).text('Escaneá el código con la cámara de tu celular y pagá con Mercado Pago.', centro, 214, { align: 'center' });
  doc.setFontSize(11).setTextColor(90).text(url, centro, 224, { align: 'center' });
  doc.save(`cartel-${archivoDe(evento.nombre)}${tipo ? `-${tipo.slug}` : ''}.pdf`);
};

/** Tarjeta de un QR de compra con sus acciones. */
function TarjetaQr({ titulo, subtitulo, url, evento, tipo, grande = false }) {
  const [img, setImg] = useState(null);
  const [aviso, setAviso] = useState('');
  useEffect(() => { qrPng(url, grande ? 480 : 280).then(setImg); }, [url, grande]);
  const avisar = (t) => { setAviso(t); setTimeout(() => setAviso(''), 1800); };
  const copiar = async () => { try { await navigator.clipboard.writeText(url); avisar('URL copiada'); } catch { avisar('No se pudo copiar'); } };
  const compartir = async () => {
    if (navigator.share) { try { await navigator.share({ title: evento.nombre, text: `Comprá tu entrada${tipo ? ` ${tipo.nombre}` : ''}`, url }); } catch { /* cancelado */ } } else copiar();
  };
  return (
    <article className={`card min-w-0 space-y-3 ${grande ? 'p-5!' : 'p-4!'}`} data-testid={tipo ? `qr-tipo-${tipo.id_tipo}` : 'qr-general'}>
      <div className="min-w-0">
        <h4 className="truncate font-semibold">{titulo}</h4>
        {subtitulo && <p className="text-xs text-zinc-500 dark:text-zinc-400">{subtitulo}</p>}
      </div>
      <div className={`mx-auto aspect-square w-full rounded-xl bg-white p-2 ring-1 ring-zinc-900/10 ${grande ? 'max-w-64' : 'max-w-44'}`}>
        {img ? <img src={img} alt={`Código QR de compra: ${titulo}`} className="h-full w-full" /> : <Skeleton className="h-full w-full" />}
      </div>
      <p className="truncate text-center font-mono text-xs text-zinc-500 dark:text-zinc-400" title={url}>{url.replace(/^https?:\/\//, '')}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary py-1.5!" onClick={() => descargarPng(url, tipo ? `${evento.nombre}-${tipo.slug}` : evento.nombre)}><DownloadSimple size={16} weight="bold" aria-hidden /> PNG</button>
        <button type="button" className="btn-secondary py-1.5!" onClick={() => descargarPdf({ url, evento, tipo })}><FilePdf size={16} weight="bold" aria-hidden /> PDF</button>
        <button type="button" className="btn-secondary py-1.5!" onClick={copiar}><Copy size={16} weight="bold" aria-hidden /> Copiar</button>
        <button type="button" className="btn-secondary py-1.5!" onClick={compartir}><ShareNetwork size={16} weight="bold" aria-hidden /> Compartir</button>
      </div>
      <p className="h-4 text-center text-xs text-emerald-700 dark:text-emerald-400" aria-live="polite">{aviso}</p>
    </article>
  );
}

/** Cobro asistido: formulario → QR de pago (esperando) → aprobado con las entradas. */
/**
 * Formulario y estados del cobro. medios / porDefecto los decide el backend (GET /admin/puerta/evento/:id):
 * permisos del rol, configuración «sólo efectivo» del club y si Mercado Pago está conectado. terminal = la
 * pantalla del cobrador (tipografía y botones más grandes, pensados para caja rápida).
 */
export function CobroAsistido({ evento, tipos, medios, porDefecto, terminal = false }) {
  const vendibles = tipos;
  const primerDisponible = vendibles.find((t) => t.disponible !== false)?.id_tipo || '';
  const [form, setForm] = useState({ id_tipo: primerDisponible, cantidad: 1, nombre: '', telefono: '', observaciones: '' });
  const [metodo, setMetodo] = useState(porDefecto || medios[0]);
  const [clave, setClave] = useState(nuevaClave);
  const [conDatos, setConDatos] = useState(false);
  const [telefonoOk, setTelefonoOk] = useState(null);
  const [cobro, setCobro] = useState(null); // respuesta de crear
  const [estado, setEstado] = useState(null); // respuesta de consultar
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const temporizador = useRef(null);

  useEffect(() => { setForm((f) => ({ ...f, id_tipo: primerDisponible })); }, [evento.id_evento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consulta el estado cada 2 s mientras el cobro está pendiente (se corta al aprobarse o al cerrar)
  useEffect(() => {
    if (!cobro || cobro.metodo_pago !== 'mercadopago') return undefined; // el efectivo ya vuelve aprobado
    let vivo = true;
    const consultar = async () => {
      try {
        const e = await adminApi.estadoCobroPuerta(cobro.id_venta);
        if (!vivo) return;
        setEstado(e);
        if (['pending', 'rejected'].includes(e.estado_pago)) temporizador.current = setTimeout(consultar, SONDEO_MS);
      } catch (err) {
        if (vivo) { setError(mensajeError(err)); temporizador.current = setTimeout(consultar, SONDEO_MS * 2); }
      }
    };
    consultar();
    return () => { vivo = false; clearTimeout(temporizador.current); };
  }, [cobro]);

  const tipo = vendibles.find((t) => t.id_tipo === Number(form.id_tipo));
  const total = (tipo?.precio || 0) * form.cantidad;
  const datosOk = !conDatos || (form.nombre.trim().length >= 2 && telefonoOk);

  const generar = async (e) => {
    e.preventDefault();
    if (!tipo || !datosOk) return;
    setEnviando(true);
    setError('');
    try {
      setEstado(null);
      const r = await adminApi.crearCobroPuerta({
        id_evento: evento.id_evento, id_tipo: tipo.id_tipo, cantidad: form.cantidad, metodo_pago: metodo, clave,
        observaciones: form.observaciones.trim() || undefined,
        comprador: conDatos ? { nombre: form.nombre.trim(), telefono: form.telefono } : undefined,
      });
      setCobro(r);
      if (r.metodo_pago === 'efectivo') setEstado(r); // venta registrada: va directo a la confirmación
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };
  const nuevo = () => { setCobro(null); setEstado(null); setClave(nuevaClave()); setForm((f) => ({ ...f, cantidad: 1, nombre: '', telefono: '', observaciones: '' })); setConDatos(false); };

  if (!vendibles.length) return <Alerta tipo="info">Este evento no tiene entradas a la venta.</Alerta>;

  // 3) Aprobado: entradas generadas, listas para escanear
  if (estado?.estado_pago === 'approved') {
    const efectivo = estado.metodo_pago === 'efectivo';
    const plural = estado.tickets.length === 1 ? '' : 's';
    return (
      <div className="space-y-4" data-testid="cobro-aprobado" role="status">
        <div className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-600/20 dark:bg-emerald-500/10 dark:ring-emerald-400/20">
          <ul className="space-y-1.5 text-lg font-semibold text-emerald-800 dark:text-emerald-200">
            {[efectivo ? 'Venta registrada en efectivo correctamente' : 'Pago aprobado', `Entrada${plural} generada${plural}`, 'Lista para escanear'].map((t) => (
              <li key={t} className="flex items-center gap-2"><CheckCircle size={24} weight="fill" className="shrink-0" aria-hidden /> {t}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-emerald-800/80 dark:text-emerald-200/80">
            {importe(estado.monto_total)} · {efectivo ? 'efectivo' : 'Mercado Pago'} · {estado.comprador}.{' '}
            {efectivo ? 'El portero puede escanear el QR desde esta pantalla.' : 'La entrada también le apareció al cliente en su celular.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {estado.tickets.map((t) => (
            <a key={t.id_ticket} href={`${t.url}?ver=1`} target="_blank" rel="noreferrer" className="card block p-2! text-center text-xs">
              <img src={`${t.url}?ver=1`} alt={`Entrada ${t.numero} con su QR`} className="w-full rounded-lg" loading="lazy" />
              <span className="mt-1 block font-medium">Entrada {t.numero} · {t.tipo}</span>
            </a>
          ))}
        </div>
        <button type="button" className="btn-primary w-full py-3!" onClick={nuevo}>Nuevo cobro</button>
      </div>
    );
  }

  // 2) Esperando el pago: QR grande para que el cliente lo escanee
  if (cobro) {
    const rechazado = estado?.estado_pago === 'rejected';
    const vencido = ['cancelled', 'refunded'].includes(estado?.estado_pago);
    return (
      <div className="space-y-4 text-center" data-testid="cobro-pendiente">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{cobro.cantidad} × {tipo?.nombre} · el cliente escanea y paga con Mercado Pago</p>
        <p className="text-4xl font-semibold tabular-nums tracking-tight">{importe(cobro.monto_total)}</p>
        <div className="mx-auto aspect-square w-full max-w-72 rounded-2xl bg-white p-3 ring-1 ring-zinc-900/10">
          <img src={cobro.qr_pago} alt="Código QR de pago de Mercado Pago" className="h-full w-full" />
        </div>
        {vencido ? (
          <Alerta>El cobro venció o se canceló. Generá uno nuevo.</Alerta>
        ) : (
          <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${rechazado ? 'bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300'}`} role="status" aria-live="polite">
            {rechazado ? <XCircle size={18} weight="fill" aria-hidden /> : <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" aria-hidden />}
            {rechazado ? 'Pago rechazado: el cliente puede reintentar con el mismo QR' : 'Esperando el pago…'}
          </p>
        )}
        <Alerta onClose={() => setError('')}>{error}</Alerta>
        <div className="grid gap-2 sm:grid-cols-2">
          <a className="btn-secondary" href={cobro.init_point} target="_blank" rel="noreferrer">Abrir link de pago</a>
          <button type="button" className="btn-secondary" onClick={nuevo}>Cancelar y volver</button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Se confirma sola cuando Mercado Pago aprueba. El cobro vence {fecha(cobro.expira_en)}.</p>
      </div>
    );
  }

  // 1) Formulario
  return (
    <form onSubmit={generar} className="space-y-4" data-testid="cobro-form">
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <fieldset className={`grid gap-2 ${terminal ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`} data-testid="tipos-cobro">
        <legend className="label">Tipo de entrada</legend>
        {vendibles.map((t) => {
          const agotada = t.disponible === false;
          return (
            <label key={t.id_tipo} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ring-1 transition-[box-shadow,background-color] duration-150 ${terminal ? 'min-h-20 text-lg' : 'min-h-14'} ${agotada ? 'cursor-not-allowed opacity-50 ring-zinc-900/10 dark:ring-white/10' : Number(form.id_tipo) === t.id_tipo ? 'cursor-pointer bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'cursor-pointer ring-zinc-900/10 dark:ring-white/10'}`}>
              <input type="radio" name="cobro-tipo" className="sr-only" checked={Number(form.id_tipo) === t.id_tipo} disabled={agotada} onChange={() => setForm({ ...form, id_tipo: t.id_tipo, cantidad: 1 })} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{t.nombre}</span>
                {(agotada || t.quedan) && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{agotada ? 'Agotada' : `Quedan ${t.quedan}`}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{moneda(t.precio)}</span>
            </label>
          );
        })}
      </fieldset>
      <div className="flex items-center justify-between gap-3">
        <span className="label mb-0!">Cantidad</span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => setForm({ ...form, cantidad: Math.max(1, form.cantidad - 1) })} disabled={form.cantidad <= 1} aria-label="Una entrada menos"
            className="grid h-11 w-11 place-items-center rounded-full ring-1 ring-zinc-900/10 active:scale-[0.92] disabled:opacity-40 dark:ring-white/15"><Minus size={18} weight="bold" aria-hidden /></button>
          <span className="w-8 text-center text-xl font-semibold tabular-nums">{form.cantidad}</span>
          <button type="button" onClick={() => setForm({ ...form, cantidad: Math.min(20, form.cantidad + 1) })} aria-label="Una entrada más"
            className="grid h-11 w-11 place-items-center rounded-full bg-indigo-600 text-white active:scale-[0.92]"><Plus size={18} weight="bold" aria-hidden /></button>
        </span>
      </div>
      {/* Método de pago: sólo los permitidos (si hay uno solo, no hay nada que elegir) */}
      {medios.length > 1 ? (
        <fieldset className="grid grid-cols-2 gap-2" data-testid="metodo-pago">
          <legend className="label">Método de pago</legend>
          {[['efectivo', 'Efectivo', Money, 'Cobrás en mano y entra al instante'], ['mercadopago', 'Mercado Pago QR', QrCode, 'El cliente paga desde su celular']]
            .filter(([valor]) => medios.includes(valor))
            .sort(([a]) => (a === porDefecto ? -1 : 1))
            .map(([valor, texto, Icono, ayuda]) => (
              <label key={valor} className={`flex min-h-16 cursor-pointer flex-col justify-center gap-0.5 rounded-xl px-3 py-2 ring-1 transition-[box-shadow,background-color] duration-150 ${metodo === valor ? 'bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10' : 'ring-zinc-900/10 dark:ring-white/10'}`}>
                <input type="radio" name="metodo-pago" className="sr-only" value={valor} checked={metodo === valor} onChange={() => setMetodo(valor)} />
                <span className="flex items-center gap-1.5 font-semibold"><Icono size={18} weight="duotone" aria-hidden /> {texto}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{ayuda}</span>
              </label>
            ))}
        </fieldset>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400" data-testid="metodo-unico"><Money size={18} weight="duotone" aria-hidden /> Cobro en efectivo</p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={conDatos} onChange={(e) => setConDatos(e.target.checked)} /> Cargar datos del cliente (opcional: recibe la entrada por WhatsApp y correo)
      </label>
      {conDatos && (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="cobro-nombre">Nombre y apellido</label>
            <input id="cobro-nombre" className="input" autoComplete="off" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </div>
          <WhatsappInput label="WhatsApp" value={form.telefono} onChange={(telefono) => setForm({ ...form, telefono })} onValidez={setTelefonoOk} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="cobro-observaciones">Observaciones (opcional)</label>
        <input id="cobro-observaciones" className="input" maxLength={255} placeholder="Ej. pagó con billete de 20.000" value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
      </div>
      <div className="flex items-baseline justify-between border-t border-zinc-100 pt-3 dark:border-white/10">
        <span className="font-medium">Total{metodo === 'efectivo' ? ' a cobrar' : ''}</span>
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{importe(total)}</span>
      </div>
      {/* Deshabilitado mientras se envía + clave de operación en el servidor: nunca dos ventas por un doble click */}
      <button className={`btn-primary w-full py-3! text-base! ${metodo === 'efectivo' ? 'bg-emerald-600! hover:bg-emerald-500!' : ''}`} disabled={!tipo || !datosOk || enviando} data-testid="generar-cobro">
        {metodo === 'efectivo' ? <Money size={20} weight="bold" aria-hidden /> : <Wallet size={20} weight="bold" aria-hidden />}
        {enviando ? (metodo === 'efectivo' ? 'Registrando…' : 'Generando…') : metodo === 'efectivo' ? 'Registrar venta e ingresar' : 'Generar QR'}
      </button>
    </form>
  );
}

/**
 * Terminal de cobro (rol cobrador): una sola pantalla, sin panel ni estadísticas. Elegir evento (si hay más
 * de uno), tipo, cantidad y registrar. Efectivo preseleccionado; Mercado Pago como alternativa si el club lo usa.
 */
export function TerminalCobro() {
  const [eventos, setEventos] = useState(null);
  const [idEvento, setIdEvento] = useState('');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.eventosBoleteria()
      .then((evs) => { setEventos(evs); setIdEvento(String(evs[0]?.id_evento || '')); })
      .catch((e) => setError(mensajeError(e)));
  }, []);
  useEffect(() => {
    setDatos(null);
    if (idEvento) adminApi.eventoBoleteria(idEvento).then(setDatos).catch((e) => setError(mensajeError(e)));
  }, [idEvento]);

  if (error && !eventos) return <Alerta>{error}</Alerta>;
  if (!eventos) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (!eventos.length) return <Vacio icono={Money} titulo="No hay eventos para cobrar">Cuando haya un evento a la venta, vas a poder cobrar entradas acá.</Vacio>;

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="terminal-cobro">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Cobro en boletería</h1>
        {eventos.length > 1 ? (
          <select aria-label="Evento" className="input sm:w-auto!" value={idEvento} onChange={(e) => setIdEvento(e.target.value)}>
            {eventos.map((e) => <option key={e.id_evento} value={e.id_evento}>{e.nombre} · {fecha(e.fecha)}</option>)}
          </select>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{eventos[0].nombre} · {fecha(eventos[0].fecha)}</p>
        )}
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <div className="card p-5! sm:p-6!">
        {!datos ? <Skeleton className="h-80" /> : datos.evento.tiene_seating
          ? <Alerta tipo="info">Este evento tiene asientos numerados: no se cobra desde la boletería rápida.</Alerta>
          : <CobroAsistido key={datos.evento.id_evento} terminal evento={datos.evento} tipos={datos.tipos} medios={datos.medios} porDefecto={datos.por_defecto} />}
      </div>
    </div>
  );
}

export default function VentaPuerta() {
  const [eventos, setEventos] = useState(null);
  const [idEvento, setIdEvento] = useState('');
  const [qrs, setQrs] = useState(null);
  const [boleteria, setBoleteria] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    eventosApi.listarTodos()
      .then((evs) => { const vigentes = evs.filter((e) => e.estado !== 'cancelado'); setEventos(vigentes); setIdEvento(String(eventoPorDefecto(vigentes))); })
      .catch((e) => setError(mensajeError(e)));
  }, []);
  useEffect(() => {
    setQrs(null);
    setBoleteria(null);
    if (idEvento) {
      adminApi.qrCompra(idEvento).then(setQrs).catch((e) => setError(mensajeError(e)));
      adminApi.eventoBoleteria(idEvento).then(setBoleteria).catch((e) => setError(mensajeError(e)));
    }
  }, [idEvento]);

  if (error && !eventos) return <Alerta>{error}</Alerta>;
  if (!eventos) return <Skeleton className="h-64" />;
  if (!eventos.length) return <Vacio icono={QrCode} titulo="Todavía no hay eventos">Creá un evento para generar sus QR de compra.</Vacio>;

  return (
    <div className="space-y-6" data-testid="venta-puerta">
      <div className="card p-4!">
        <label className="label" htmlFor="vp-evento">Evento</label>
        <select id="vp-evento" className="input" value={idEvento} onChange={(e) => setIdEvento(e.target.value)}>
          {[...eventos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map((e) => <option key={e.id_evento} value={e.id_evento}>{e.nombre} · {fecha(e.fecha)}</option>)}
        </select>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>

      {!qrs ? <Skeleton className="h-64" /> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="order-2 min-w-0 space-y-4 lg:order-none lg:col-span-3" aria-labelledby="titulo-qr-compra">
            <div>
              <h2 id="titulo-qr-compra" className="text-lg font-semibold">QR de compra</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Imprimilos y ponelos en la puerta: el cliente escanea, compra desde su celular y entra con su QR.</p>
            </div>
            {qrs.evento.tiene_seating && <Alerta tipo="info">Este evento tiene asientos numerados: la compra rápida no aplica (hay que elegir butaca en la cartelera).</Alerta>}
            <TarjetaQr grande titulo="QR general" subtitulo="Todos los tipos de entrada" url={qrs.general.url} evento={qrs.evento} />
            {qrs.por_tipo.length > 0 && (
              <>
                <h3 className="font-semibold">Por tipo de entrada <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">· compra en un paso</span></h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {qrs.por_tipo.map((t) => <TarjetaQr key={t.id_tipo} titulo={t.nombre} subtitulo={moneda(t.precio)} url={t.url} evento={qrs.evento} tipo={t} />)}
                </div>
              </>
            )}
          </section>
          {/* En celular el cobro va primero: en la boletería es lo que se usa una y otra vez */}
          <section className="order-1 min-w-0 lg:order-none lg:col-span-2" aria-labelledby="titulo-cobro">
            <div className="card space-y-3 lg:sticky lg:top-24">
              <div>
                <h2 id="titulo-cobro" className="text-lg font-semibold">Cobro en boletería</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Con Mercado Pago, el cliente escanea el QR y se confirma solo. En efectivo, la venta queda registrada al instante.</p>
              </div>
              {boleteria ? <CobroAsistido key={boleteria.evento.id_evento} evento={boleteria.evento} tipos={boleteria.tipos} medios={boleteria.medios} porDefecto={boleteria.por_defecto} /> : <Skeleton className="h-64" />}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
