import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, STORAGE } from '../api/client';

const AuthContext = createContext(null);

// Último usuario conocido: permite abrir la app instalada (PWA) sin conexión sin perder la sesión
const CLAVE_USUARIO = 'usuario';
const recordar = (u) => { try { localStorage.setItem(CLAVE_USUARIO, JSON.stringify(u)); } catch { /* sin storage */ } return u; };
const recordado = () => { try { return JSON.parse(localStorage.getItem(CLAVE_USUARIO)); } catch { return null; } };

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  const guardarSesion = ({ token, usuario }) => {
    localStorage.setItem(STORAGE.token, token);
    setUsuario(recordar(usuario));
    return usuario;
  };

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE.token);
    localStorage.removeItem(CLAVE_USUARIO);
    setUsuario(null);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE.token)) return setCargando(false);
    authApi
      .me()
      .then((u) => setUsuario(recordar(u)))
      // Sin respuesta (sin conexión): se mantiene la sesión con el último usuario. Un 401 sí la cierra.
      .catch((err) => (!err.response && recordado() ? setUsuario(recordado()) : logout()))
      .finally(() => setCargando(false));
  }, [logout]);

  useEffect(() => {
    window.addEventListener('sesion-expirada', logout);
    return () => window.removeEventListener('sesion-expirada', logout);
  }, [logout]);

  const rol = usuario?.rol;
  const value = {
    usuario,
    setUsuario,
    cargando,
    rol,
    esSuperadmin: rol === 'superadmin',
    /** admin del tenant o superadmin (este último operando sobre el complejo elegido) */
    esAdmin: rol === 'admin' || rol === 'superadmin',
    esVendedor: rol === 'vendedor',
    esComprador: rol === 'comprador',
    login: async (d) => guardarSesion(await authApi.login(d)),
    register: async (d) => guardarSesion(await authApi.register(d)),
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
