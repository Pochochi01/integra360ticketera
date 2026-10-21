import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { MapTrifold } from '@phosphor-icons/react';
import Navbar from './components/Navbar';
import { useAuth } from './context/AuthContext';
import { useTenant } from './context/TenantContext';
import { Alerta, Spinner, Vacio } from './components/ui';
import Eventos from './pages/Eventos';
import PaginaInicio from './pages/Inicio';
import EventoDetalle from './pages/EventoDetalle';
import Pago from './pages/Pago';
import MiCuenta from './pages/MiCuenta';
import Login from './pages/Login';
import Registro from './pages/Registro';
import LinkVenta from './pages/LinkVenta';
import Entrada from './pages/Entrada';
import PagoResultado from './pages/PagoResultado';
import AdminIntegraciones from './pages/admin/AdminIntegraciones';
import SuperPlataforma from './pages/super/SuperPlataforma';
import Porteria from './pages/Porteria';
import Checkout from './pages/Checkout';
import VentaLink from './pages/VentaLink';
import AvisoActualizacion from './components/AvisoActualizacion';
import VendedorPanel from './pages/vendedor/VendedorPanel';
import AdminEventos from './pages/admin/AdminEventos';
import AdminVentas from './pages/admin/AdminVentas';
import AdminEmision from './pages/admin/AdminEmision';
import AdminVendedores from './pages/admin/AdminVendedores';
import AdminComplejo from './pages/admin/AdminComplejo';
import AdminPorteros from './pages/admin/AdminPorteros';
import SuperTenants from './pages/super/SuperTenants';
import SuperUsuarios from './pages/super/SuperUsuarios';

/** Protege una ruta por roles. El superadmin necesita un complejo elegido para las pantallas de tenant. */
function Protegida({ children, roles, requiereTenant = false, estricta = false }) {
  const { usuario, cargando } = useAuth();
  const { tenant } = useTenant();
  if (cargando) return <Spinner />;
  if (!usuario) return <Navigate to="/login" replace />;
  // estricta: sólo los roles indicados, sin la excepción del superadmin (ej. la Portería es sólo para porteros)
  if (roles && !roles.includes(usuario.rol) && (estricta || usuario.rol !== 'superadmin')) return <Navigate to="/" replace />;
  if (requiereTenant && usuario.rol === 'superadmin' && !tenant) {
    return <Alerta tipo="info">Elegí un complejo en el selector superior para administrarlo.</Alerta>;
  }
  return children;
}

/** Inicio según el rol: el personal va a su panel; visitantes y compradores ven la página de inicio. */
function Inicio() {
  const { usuario } = useAuth();
  if (usuario?.rol === 'vendedor') return <Navigate to="/vendedor" replace />;
  if (usuario?.rol === 'admin') return <Navigate to="/admin/eventos" replace />;
  if (usuario?.rol === 'portero') return <Navigate to="/porteria" replace />;
  return <PaginaInicio />;
}

/** Página no encontrada (en lugar de redirigir en silencio al inicio). */
function NoEncontrada() {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Vacio icono={MapTrifold} titulo="No encontramos esta página" accion={<Link to="/eventos" className="btn-primary mt-2">Ver eventos</Link>}>
        Puede que el link esté mal escrito o que el evento ya no exista.
      </Vacio>
    </div>
  );
}

export default function App() {
  const admin = { roles: ['admin'], requiereTenant: true };
  // La página de inicio ocupa todo el ancho (hero 3D a sangre); el resto usa el contenedor estándar
  const { pathname } = useLocation();
  const pantallaCompleta = pathname === '/';
  const reducir = useReducedMotion();
  return (
    <div className="min-h-screen">
      <a href="#contenido" className="sr-only z-50 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
        Saltar al contenido
      </a>
      <Navbar />
      {/* Transición de página: corta y sutil (se navega seguido); sin desplazamiento con movimiento reducido */}
      <motion.main
        id="contenido"
        key={pathname}
        initial={reducir ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }}
        // Al terminar se quita el transform: si quedara aplicado, los modales (position: fixed) se ubicarían respecto de <main>
        animate={{ opacity: 1, transform: 'translateY(0px)', transitionEnd: { transform: 'none' } }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        className={pantallaCompleta ? '' : 'mx-auto max-w-6xl px-4 pb-16 pt-8'}
      >
        <Routes>
          {/* Público / comprador */}
          <Route path="/" element={<Inicio />} />
          <Route path="/eventos" element={<Eventos />} />
          <Route path="/eventos/:id" element={<EventoDetalle />} />
          <Route path="/v/:codigo" element={<LinkVenta />} />
          {/* Link de pago del vendedor: página del complejo + formulario del comprador */}
          <Route path="/checkout/:linkId" element={<Checkout />} />
          <Route path="/venta/:linkId" element={<VentaLink />} />
          <Route path="/entrada/:token" element={<Entrada />} />
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/ventas/:id/pagar" element={<Protegida roles={['comprador']}><Pago /></Protegida>} />
          <Route path="/ventas/:id/resultado" element={<Protegida roles={['comprador']}><PagoResultado /></Protegida>} />
          <Route path="/mi-cuenta" element={<Protegida roles={['comprador']}><MiCuenta /></Protegida>} />

          {/* Vendedor */}
          <Route path="/vendedor" element={<Protegida roles={['vendedor']}><VendedorPanel /></Protegida>} />

          {/* Portero: sólo la Portería */}
          <Route path="/porteria" element={<Protegida roles={['portero']} estricta><Porteria /></Protegida>} />

          {/* Admin del tenant */}
          <Route path="/admin/porteros" element={<Protegida {...admin}><AdminPorteros /></Protegida>} />
          <Route path="/acceso" element={<Navigate to="/admin/porteros" replace />} />
          <Route path="/admin/eventos" element={<Protegida {...admin}><AdminEventos /></Protegida>} />
          <Route path="/admin/vendedores" element={<Protegida {...admin}><AdminVendedores /></Protegida>} />
          <Route path="/admin/ventas" element={<Protegida {...admin}><AdminVentas /></Protegida>} />
          <Route path="/admin/emision" element={<Protegida {...admin}><AdminEmision /></Protegida>} />
          <Route path="/admin/integraciones" element={<Protegida {...admin}><AdminIntegraciones /></Protegida>} />
          <Route path="/admin/complejo" element={<Protegida {...admin}><AdminComplejo /></Protegida>} />

          {/* Superadmin */}
          <Route path="/super/tenants" element={<Protegida roles={['superadmin']}><SuperTenants /></Protegida>} />
          <Route path="/super/plataforma" element={<Protegida roles={['superadmin']}><SuperPlataforma /></Protegida>} />
          <Route path="/super/usuarios" element={<Protegida roles={['superadmin']}><SuperUsuarios /></Protegida>} />

          <Route path="*" element={<NoEncontrada />} />
        </Routes>
      </motion.main>
      <AvisoActualizacion />
    </div>
  );
}
