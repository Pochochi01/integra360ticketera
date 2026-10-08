import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const TemaContext = createContext(null);
const CLAVE = 'tema';
const consultaOscuro = () => window.matchMedia('(prefers-color-scheme: dark)');

const leerGuardado = () => {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === 'claro' || t === 'oscuro' ? t : null;
  } catch {
    return null;
  }
};

/**
 * Tema claro / oscuro de todo el sitio.
 * Por defecto sigue al sistema (prefers-color-scheme); si el usuario elige uno, se recuerda.
 * Se aplica como clase `dark` en <html> (variante `dark:` de Tailwind configurada por clase en index.css).
 */
export function TemaProvider({ children }) {
  const [elegido, setElegido] = useState(leerGuardado);
  const [sistema, setSistema] = useState(() => (consultaOscuro().matches ? 'oscuro' : 'claro'));
  const tema = elegido || sistema;

  useEffect(() => {
    const mq = consultaOscuro();
    const cambio = (e) => setSistema(e.matches ? 'oscuro' : 'claro');
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', tema === 'oscuro');
    // Barra de estado / ventana de la PWA instalada con el mismo color que el fondo
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', tema === 'oscuro' ? '#09090b' : '#fafafa'));
  }, [tema]);

  const alternar = useCallback(() => {
    const nuevo = tema === 'oscuro' ? 'claro' : 'oscuro';
    setElegido(nuevo);
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  }, [tema]);

  return <TemaContext.Provider value={{ tema, alternar }}>{children}</TemaContext.Provider>;
}

export const useTema = () => useContext(TemaContext);
