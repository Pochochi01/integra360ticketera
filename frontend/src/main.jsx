import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';
import { TicketsProvider } from './context/TicketsContext';
import { TemaProvider } from './context/TemaContext';
import { ConfirmarProvider } from './components/ui';
import '@fontsource-variable/geist';
import './index.css';
import { registrarPWA } from './pwa';

registrarPWA();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <TemaProvider>
        <TenantProvider>
          <AuthProvider>
            <TicketsProvider>
              <ConfirmarProvider>
                <App />
              </ConfirmarProvider>
            </TicketsProvider>
          </AuthProvider>
        </TenantProvider>
      </TemaProvider>
    </BrowserRouter>
  </React.StrictMode>
);
