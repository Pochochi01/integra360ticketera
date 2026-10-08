import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { List, Moon, Sun, Ticket } from '@phosphor-icons/react';
import { useTema } from '../context/TemaContext';

/** Estilos del navbar: siguen el tema claro / oscuro en todo el sitio. */
const tema = {
  header: 'border-zinc-900/10 bg-zinc-50/80 text-zinc-900 dark:border-white/10 dark:bg-zinc-950/70 dark:text-zinc-100',
  marca: 'text-zinc-900 dark:text-zinc-50',
  secundario: 'text-zinc-500 dark:text-zinc-400',
  menuMovil: 'border-zinc-900/10 bg-zinc-50 dark:border-white/10 dark:bg-zinc-950',
  link: (activo) =>
    activo
      ? 'bg-zinc-900/5 text-zinc-950 dark:bg-white/10 dark:text-white'
      : 'text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white',
  select: 'input w-auto! py-1.5! lg:mr-2',
  salir: 'btn-secondary py-1!',
};

const LINKS_POR_ROL = {
  visitante: [['/eventos', 'Eventos']],
  comprador: [['/eventos', 'Eventos'], ['/mi-cuenta', 'Mis tickets']],
  vendedor: [['/vendedor', 'Mi punto de venta']],
  admin: [
    ['/admin/eventos', 'Eventos'], ['/admin/vendedores', 'Vendedores'], ['/admin/ventas', 'Ventas'],
    ['/admin/emision', 'Emisión'], ['/admin/porteros', 'Porteros'], ['/admin/integraciones', 'Integraciones'], ['/admin/complejo', 'Mi complejo'],
  ],
  portero: [['/porteria', 'Portería']],
  superadmin: [['/super/tenants', 'Complejos'], ['/super/plataforma', 'Plataforma'], ['/super/usuarios', 'Usuarios']],
};

export default function Navbar() {
  const { tema: modo, alternar } = useTema();
  const { usuario, logout } = useAuth();
  const { tenants, tenant, tenantActual, setTenant } = useTenant();
  const [abierto, setAbierto] = useState(false);
  const navigate = useNavigate();

  const rol = usuario?.rol || 'visitante';
  const links = LINKS_POR_ROL[rol];
  // El superadmin, con un complejo elegido, además administra ese complejo: esos enlaces van en una segunda barra
  // (en escritorio no entran 10 enlaces en una sola línea; en móvil se suman al menú)
  const linksComplejo = rol === 'superadmin' && tenant ? LINKS_POR_ROL.admin : [];
  const claseLink = ({ isActive }) => `block rounded-lg px-3 py-2 text-sm font-medium lg:px-2.5 xl:px-3 ${tema.link(isActive)}`;
  // El selector de complejo es para visitantes, compradores y el superadmin (el personal queda fijo en su tenant)
  const muestraSelector = ['visitante', 'comprador', 'superadmin'].includes(rol);

  return (
    <header className={`sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] backdrop-blur ${tema.header}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className={`flex shrink-0 items-center gap-2 text-lg font-bold ${tema.marca}`}>
          <Ticket size={24} weight="duotone" className="text-indigo-500" aria-hidden />
          Integra360
          {usuario?.tenant && <span className={`text-sm font-medium ${tema.secundario}`}>· {usuario.tenant}</span>}
          {!usuario?.tenant && tenantActual && <span className={`text-sm font-medium ${tema.secundario}`}>· {tenantActual.nombre}</span>}
        </Link>
        <button className="rounded p-2 lg:hidden" onClick={() => setAbierto(!abierto)} aria-label="Menú" aria-expanded={abierto}><List size={22} weight="bold" aria-hidden /></button>
        <nav className={`${abierto ? 'flex' : 'hidden'} absolute left-0 right-0 top-full flex-col gap-1 border-b p-3 ${tema.menuMovil} lg:static lg:flex lg:flex-row lg:items-center lg:border-0 lg:bg-transparent lg:p-0`}>
          {muestraSelector && (
            <select
              className={tema.select}
              value={tenant}
              onChange={(e) => { setTenant(e.target.value); navigate(rol === 'superadmin' ? '/super/tenants' : '/eventos'); }}
              aria-label="Complejo"
            >
              <option value="">{rol === 'superadmin' ? 'Elegir complejo…' : 'Todos los complejos'}</option>
              {tenants.map((t) => <option key={t.slug} value={t.slug}>{t.nombre}</option>)}
            </select>
          )}
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end className={claseLink} onClick={() => setAbierto(false)}>{label}</NavLink>
          ))}
          {linksComplejo.length > 0 && (
            <div className="border-t border-zinc-900/10 pt-1 lg:hidden dark:border-white/10">
              {linksComplejo.map(([to, label]) => (
                <NavLink key={to} to={to} end className={claseLink} onClick={() => setAbierto(false)}>{label}</NavLink>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={alternar}
            aria-label={modo === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={modo === 'oscuro' ? 'Modo claro' : 'Modo oscuro'}
            className="grid h-9 w-9 place-items-center self-start rounded-full text-zinc-600 ring-1 ring-zinc-900/10 transition-[transform,background-color] duration-150 ease-out hover:bg-zinc-900/5 active:scale-[0.94] lg:ml-1 lg:self-auto dark:text-zinc-300 dark:ring-white/15 dark:hover:bg-white/10"
          >
            {modo === 'oscuro' ? <Sun size={18} weight="bold" aria-hidden /> : <Moon size={18} weight="bold" aria-hidden />}
          </button>
          {usuario ? (
            <div className="flex items-center gap-2 lg:ml-3">
              <span className={`text-sm lg:hidden xl:inline ${tema.secundario}`}>{usuario.nombre}</span>
              <button className={tema.salir} onClick={() => { logout(); navigate('/'); }}>Salir</button>
            </div>
          ) : (
            <NavLink to="/login" className="btn-primary lg:ml-3" onClick={() => setAbierto(false)}>Ingresar</NavLink>
          )}
        </nav>
      </div>
      {linksComplejo.length > 0 && (
        <div className="hidden border-t border-zinc-900/5 lg:block dark:border-white/5">
          <nav aria-label="Administración del complejo" className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-1.5 scrollbar-none">
            <span className={`mr-2 shrink-0 text-xs ${tema.secundario}`}>Administrando <b>{tenantActual?.nombre || tenant}</b></span>
            {linksComplejo.map(([to, label]) => (
              <NavLink key={to} to={to} end className={(e) => `${claseLink(e)} shrink-0 py-1.5!`}>{label}</NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
