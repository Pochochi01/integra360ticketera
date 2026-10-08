import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ticketsApi, ventasApi, eventosApi } from '../api/client';
import { useAuth } from './AuthContext';

const TicketsContext = createContext(null);
const VACIO = { tickets: [], ventas: [], transferencias: [], espera: [], cargando: false };

/** Estado global de lo que posee el comprador: tickets, compras, transferencias y lista de espera. */
export function TicketsProvider({ children }) {
  const { usuario } = useAuth();
  const [estado, setEstado] = useState(VACIO);

  const refrescar = useCallback(async () => {
    if (usuario?.rol !== 'comprador') return setEstado(VACIO);
    setEstado((s) => ({ ...s, cargando: true }));
    const [tickets, ventas, transferencias, espera] = await Promise.all([
      ticketsApi.mios(), ventasApi.mias(), ticketsApi.transferencias(), eventosApi.miEspera(),
    ]);
    setEstado({ tickets, ventas, transferencias, espera, cargando: false });
  }, [usuario]);

  useEffect(() => {
    refrescar().catch(() => setEstado((s) => ({ ...s, cargando: false })));
  }, [refrescar]);

  return <TicketsContext.Provider value={{ ...estado, refrescar }}>{children}</TicketsContext.Provider>;
}

export const useTickets = () => useContext(TicketsContext);
