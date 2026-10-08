import { useEffect, useState } from 'react';
import { eventosApi, mensajeError, ventasApi } from '../../api/client';
import { Alerta, Tabs } from '../../components/ui';
import { moneda } from '../../utils/format';

/** Emisión administrativa: venta corporativa (bloques) e invitaciones gratuitas. */
export default function AdminEmision() {
  const [tab, setTab] = useState('corporativa');
  const [eventos, setEventos] = useState([]);
  const [evento, setEvento] = useState(null);
  const [form, setForm] = useState({ email_destino: '', empresa: '', metodo_pago: 'transferencia', marcar_pagado: false });
  const [cantidades, setCantidades] = useState({});
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => { eventosApi.listarTodos().then(setEventos); }, []);

  const elegirEvento = async (id) => {
    setCantidades({});
    setEvento(id ? await eventosApi.detalle(id) : null);
  };

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    const items = Object.entries(cantidades).filter(([, c]) => Number(c) > 0).map(([id_tipo, cantidad]) => ({ id_tipo: Number(id_tipo), cantidad: Number(cantidad) }));
    if (!items.length) return setError('Indicá al menos una cantidad');
    try {
      const datos = { ...form, id_evento: evento.id_evento, items };
      const r = tab === 'corporativa' ? await ventasApi.corporativa(datos) : await ventasApi.invitacion(datos);
      setAviso(`Venta #${r.venta.id_venta} creada con ${r.tickets.length} tickets (${r.venta.estado}) para ${form.email_destino}`);
      setCantidades({});
      elegirEvento(evento.id_evento);
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">Emisión administrativa</h1>
      <Tabs tabs={[['corporativa', 'Venta corporativa'], ['invitacion', 'Invitaciones']]} activa={tab} onChange={setTab} />
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>
      <form onSubmit={enviar} className="card space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {tab === 'corporativa'
            ? 'Bloque de tickets para una empresa. No aplica el límite por persona. Los tickets se emiten a nombre del contacto indicado, que luego puede transferirlos.'
            : 'Tickets gratuitos (cortesía). Se emiten válidos inmediatamente, sin pago.'}
        </p>
        <div>
          <label className="label" htmlFor="campo-adminemision-evento">Evento</label>
          <select id="campo-adminemision-evento" className="input" onChange={(e) => elegirEvento(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {eventos.filter((e) => ['publicado', 'agotado'].includes(e.estado)).map((e) => <option key={e.id_evento} value={e.id_evento}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="campo-adminemision-email-del-destinatario-contacto-debe-ten">Email del destinatario / contacto (debe tener cuenta)</label>
          <input id="campo-adminemision-email-del-destinatario-contacto-debe-ten" className="input" type="email" value={form.email_destino} onChange={set('email_destino')} required />
        </div>
        {tab === 'corporativa' && (
          <>
            <div><label className="label" htmlFor="campo-adminemision-empresa">Empresa</label><input id="campo-adminemision-empresa" className="input" value={form.empresa} onChange={set('empresa')} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={form.metodo_pago} onChange={set('metodo_pago')}>
                <option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="billetera">Billetera</option>
              </select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.marcar_pagado} onChange={set('marcar_pagado')} /> Ya pagado</label>
            </div>
          </>
        )}
        {evento && (
          <div className="space-y-2">
            <span className="label">Cantidades</span>
            {evento.tipos.filter((t) => t.activo).map((t) => (
              <div key={t.id_tipo} className="flex items-center justify-between gap-3 text-sm">
                <span>{t.nombre_tipo} · {tab === 'invitacion' ? 'Gratis' : moneda(t.precio)} · {t.stock_disponible} disp.</span>
                <input className="input w-24!" type="number" min="0" max={t.stock_disponible} value={cantidades[t.id_tipo] || ''} onChange={(e) => setCantidades({ ...cantidades, [t.id_tipo]: e.target.value })} />
              </div>
            ))}
            {evento.tiene_seating ? <p className="text-xs text-amber-700 dark:text-amber-300">Evento con seating: la emisión en bloque requiere asignar asientos vía API.</p> : null}
          </div>
        )}
        <button className="btn-primary w-full" disabled={!evento}>{tab === 'corporativa' ? 'Crear venta corporativa' : 'Emitir invitaciones'}</button>
      </form>
    </div>
  );
}
