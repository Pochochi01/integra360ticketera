import { useEffect, useState } from 'react';
import { ArrowClockwise, WhatsappLogo } from '@phosphor-icons/react';
import { mensajeError, vendedorApi } from '../../api/client';
import GenerarLinkPago from '../../components/vendedor/GenerarLinkPago';
import GenerarLinkCheckout from '../../components/vendedor/GenerarLinkCheckout';
import LinksVentaAdmin from '../../components/admin/LinksVentaAdmin';
import { Alerta, Badge, Spinner, Tabs } from '../../components/ui';
import { fecha, importe, moneda } from '../../utils/format';
import { ESTADO_CORREO, urlWhatsappEntradas } from '../../utils/entradasWhatsapp';

const Stat = ({ label, valor }) => (
  <div className="card p-4!">
    <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
    <p className="mt-1 text-2xl font-bold">{valor}</p>
  </div>
);

// Estado del pago (MercadoPago) → texto y color del badge
const ESTADOS_PAGO = {
  approved: { texto: 'Aprobado', estado: 'pagado' },
  pending: { texto: 'Pendiente', estado: 'pendiente' },
  rejected: { texto: 'Rechazado', estado: 'cancelado' },
  cancelled: { texto: 'Cancelado', estado: 'usado' },
  refunded: { texto: 'Reembolsado', estado: 'reembolsado' },
};
const FILTROS = [['', 'Todas'], ['approved', 'Aprobadas'], ['pending', 'Pendientes'], ['rejected', 'Rechazadas']];

const MODOS = [['reutilizable', 'Link reutilizable'], ['checkout', 'Link para el cliente'], ['compra', 'Cargar la compra']];


/** Panel del punto de venta: generar links (reutilizables o para un cliente) y ver las ventas atribuidas. */
export default function VendedorPanel() {
  const [perfil, setPerfil] = useState(null);
  const [todas, setTodas] = useState([]); // para los totales
  const [ventas, setVentas] = useState(null); // listado con el filtro aplicado
  const [filtro, setFiltro] = useState('');
  const [eventos, setEventos] = useState([]);
  const [tab, setTab] = useState('cobrar');
  const [modoCobro, setModoCobro] = useState('reutilizable');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [reenviando, setReenviando] = useState(null);

  const cargar = async () => {
    try {
      const [p, v, e] = await Promise.all([vendedorApi.perfil(), vendedorApi.ventas(), vendedorApi.eventos()]);
      setPerfil(p); setTodas(v); setEventos(e);
    } catch (err) {
      setError(mensajeError(err));
    }
  };
  useEffect(() => { cargar(); }, []);
  // El filtro lo resuelve el backend (estado_pago), así coincide con lo que informa MercadoPago
  useEffect(() => {
    setVentas(null);
    vendedorApi.ventas(filtro ? { estado_pago: filtro } : undefined).then(setVentas).catch((err) => setError(mensajeError(err)));
  }, [filtro, todas]);

  const reenviar = async (v) => {
    setReenviando(v.id_venta);
    setError('');
    try {
      const r = await vendedorApi.reenviarCorreo(v.id_venta);
      if (r.estado === 'sent') setAviso(`Correo reenviado a ${r.destino}`);
      else setError(`No se pudo enviar: ${r.motivo}. Mandale los links por WhatsApp.`);
      setTodas(await vendedorApi.ventas());
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setReenviando(null);
    }
  };

  if (!perfil) return error ? <Alerta>{error}</Alerta> : <Spinner />;

  const aprobadas = todas.filter((v) => v.estado_pago === 'approved');
  const total = aprobadas.reduce((s, v) => s + Number(v.monto_total), 0);
  const entradas = aprobadas.reduce((s, v) => s + v.cantidad_tickets, 0);
  const mercadopago = (perfil.medios_pago || []).includes('mercadopago');

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Hola, {perfil.nombre}</h1>
        <p className="text-zinc-500 dark:text-zinc-400">Punto de venta de {perfil.tenant.nombre} · WhatsApp {perfil.whatsapp}</p>
      </div>
      <Alerta onClose={() => setError('')}>{error}</Alerta>
      <Alerta tipo="exito" onClose={() => setAviso('')}>{aviso}</Alerta>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Ventas aprobadas" valor={aprobadas.length} />
        <Stat label="Entradas vendidas" valor={entradas} />
        <Stat label="Total vendido" valor={importe(total)} />
        <Stat label="Pagos pendientes" valor={todas.filter((v) => v.estado_pago === 'pending').length} />
      </div>

      <Tabs tabs={[['cobrar', 'Link de pago'], ['ventas', `Mis ventas (${todas.length})`]]} activa={tab} onChange={setTab} />

      {tab === 'cobrar' && (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Tipo de link" className="flex flex-wrap gap-1 rounded-2xl bg-zinc-100 p-1 text-sm sm:inline-flex sm:rounded-full dark:bg-white/5">
            {MODOS.map(([clave, texto]) => (
              <button key={clave} type="button" role="radio" aria-checked={modoCobro === clave} onClick={() => setModoCobro(clave)}
                className={`flex-1 rounded-full px-4 py-1.5 font-medium transition-[background-color,box-shadow] duration-150 sm:flex-none ${modoCobro === clave ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>
                {texto}
              </button>
            ))}
          </div>
          {modoCobro === 'reutilizable' && (
            <>
              {!mercadopago && <Alerta tipo="info">El complejo todavía no tiene MercadoPago conectado: tus links no van a poder cobrar hasta que el administrador lo conecte.</Alerta>}
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Un link para compartir en Instagram, Facebook o WhatsApp: lo pueden usar muchos compradores. Cada pago se acredita en la cuenta del complejo y la venta queda a tu nombre.</p>
              <LinksVentaAdmin modo="vendedor" />
            </>
          )}
          {modoCobro === 'checkout' && <GenerarLinkCheckout eventos={eventos} mercadopago={mercadopago} onGenerado={cargar} />}
          {modoCobro === 'compra' && <GenerarLinkPago eventos={eventos} medios={perfil.medios_pago || []} onGenerado={cargar} />}
        </div>
      )}

      {tab === 'ventas' && (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Filtrar por estado del pago" className="flex flex-wrap gap-2" data-testid="filtro-ventas">
            {FILTROS.map(([clave, texto]) => (
              <button key={clave || 'todas'} type="button" role="radio" aria-checked={filtro === clave} onClick={() => setFiltro(clave)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition-colors duration-150 ${filtro === clave ? 'bg-indigo-600 text-white ring-indigo-600' : 'ring-zinc-900/10 hover:bg-zinc-50 dark:ring-white/15 dark:hover:bg-white/5'}`}>
                {texto}
              </button>
            ))}
          </div>
          {!ventas ? <Spinner /> : (
            <div className="card overflow-x-auto p-0!">
              <table className="tabla">
                <thead className="bg-zinc-50 dark:bg-white/5 text-left text-zinc-500 dark:text-zinc-400">
                  <tr><th className="p-3">#</th><th className="p-3">Fecha</th><th className="p-3">Evento</th><th className="p-3">Comprador</th><th className="p-3">Entradas</th><th className="p-3">Total</th><th className="p-3">Pago</th><th className="p-3">Correo</th><th className="p-3" /></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {ventas.map((v) => (
                    <tr key={v.id_venta} data-testid={`venta-${v.id_venta}`}>
                      <td className="p-3">{v.id_venta}</td>
                      <td className="p-3">{fecha(v.fecha_venta)}</td>
                      <td className="p-3">{v.evento}</td>
                      <td className="p-3">{v.comprador}<div className="text-xs text-zinc-400 dark:text-zinc-500">{v.whatsapp_oculto}</div></td>
                      <td className="p-3">{v.cantidad_tickets}</td>
                      <td className="p-3">{moneda(v.monto_total)}</td>
                      <td className="p-3"><Badge {...(ESTADOS_PAGO[v.estado_pago] || { estado: v.estado })} /></td>
                      <td className="p-3">{v.estado_correo ? <Badge {...ESTADO_CORREO[v.estado_correo]} /> : <span className="text-xs text-zinc-400">—</span>}</td>
                      <td className="space-x-2 whitespace-nowrap p-3 text-right">
                        {v.estado_pago === 'approved' && (
                          <button type="button" className="btn-secondary py-1!" onClick={() => reenviar(v)} disabled={reenviando === v.id_venta} aria-label={`Reenviar el correo con las entradas a ${v.comprador}`}>
                            <ArrowClockwise size={14} weight="bold" className={reenviando === v.id_venta ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden /> Correo
                          </button>
                        )}
                        {v.whatsapp && (
                          <a className="btn-secondary py-1! text-emerald-700 dark:text-emerald-400" href={urlWhatsappEntradas(v)} target="_blank" rel="noreferrer"
                            aria-label={`Escribir por WhatsApp a ${v.comprador}`} data-testid="boton-whatsapp">
                            <WhatsappLogo size={16} weight="fill" aria-hidden /> WhatsApp
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {ventas.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-zinc-400 dark:text-zinc-500">{filtro ? 'No hay ventas con ese estado' : 'Todavía no hay ventas con tus links'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
