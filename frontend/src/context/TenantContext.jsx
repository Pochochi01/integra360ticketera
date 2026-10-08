import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STORAGE, tenantsApi } from '../api/client';

const TenantContext = createContext(null);
const DIAS_REFERIDO = 7;

const leerJson = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch {
    return null;
  }
};

/**
 * Tenant (complejo) seleccionado y referido de vendedor.
 *  - tenant: slug elegido por el visitante (o por el superadmin para administrar). Se envía como X-Tenant.
 *    Con ?complejo=slug en la URL se preselecciona (útil sin subdominios).
 *  - referido: link de vendedor por el que llegó el comprador; se adjunta a la compra durante 7 días.
 */
export function TenantProvider({ children }) {
  const [tenants, setTenants] = useState([]);
  const [tenant, setTenantState] = useState(() => {
    const desdeUrl = new URLSearchParams(window.location.search).get('complejo');
    if (desdeUrl) localStorage.setItem(STORAGE.tenant, desdeUrl);
    return localStorage.getItem(STORAGE.tenant) || '';
  });
  const [referido, setReferidoState] = useState(() => {
    const r = leerJson(STORAGE.referido);
    return r && r.expira > Date.now() ? r : null;
  });

  useEffect(() => {
    tenantsApi.publico().then(setTenants).catch(() => {});
  }, []);

  const setTenant = useCallback((slug) => {
    if (slug) localStorage.setItem(STORAGE.tenant, slug);
    else localStorage.removeItem(STORAGE.tenant);
    setTenantState(slug || '');
  }, []);

  const setReferido = useCallback((r) => {
    if (r) {
      const conExpira = { ...r, expira: Date.now() + DIAS_REFERIDO * 864e5 };
      localStorage.setItem(STORAGE.referido, JSON.stringify(conExpira));
      setReferidoState(conExpira);
    } else {
      localStorage.removeItem(STORAGE.referido);
      setReferidoState(null);
    }
  }, []);

  const tenantActual = tenants.find((t) => t.slug === tenant) || null;

  return (
    <TenantContext.Provider value={{ tenants, tenant, tenantActual, setTenant, referido, setReferido }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
