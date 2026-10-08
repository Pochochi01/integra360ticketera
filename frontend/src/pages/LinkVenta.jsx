import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mensajeError, publicoApi } from '../api/client';
import { useTenant } from '../context/TenantContext';
import { Alerta, Spinner } from '../components/ui';

/**
 * /v/:codigo — entrada por link de vendedor.
 * Guarda el referido (se adjunta a la compra), fija el complejo y lleva al evento o al listado del complejo.
 */
export default function LinkVenta() {
  const { codigo } = useParams();
  const navigate = useNavigate();
  const { setTenant, setReferido } = useTenant();
  const [error, setError] = useState('');

  useEffect(() => {
    publicoApi
      .link(codigo)
      .then((link) => {
        setReferido({ codigo: link.codigo, vendedor: link.vendedor, id_tenant: link.tenant.id_tenant, id_evento: link.id_evento });
        setTenant(link.tenant.slug);
        navigate(link.id_evento ? `/eventos/${link.id_evento}` : '/eventos', { replace: true });
      })
      .catch((e) => setError(mensajeError(e)));
  }, [codigo]);

  if (error) {
    return (
      <div className="mx-auto max-w-md">
        <Alerta>{error}</Alerta>
        <button className="btn-secondary" onClick={() => navigate('/eventos')}>Ver eventos</button>
      </div>
    );
  }
  return <Spinner />;
}
