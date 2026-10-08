/**
 * WhatsApp Business Cloud API (Meta).
 * credentials: { phone_number_id, access_token, template?, idioma? }
 *
 * Meta sólo permite texto libre dentro de la ventana de 24 h desde el último mensaje del cliente.
 * Para iniciar la conversación (caso típico: enviar la entrada) hay que usar una plantilla aprobada:
 * si `template` está configurado se envía esa plantilla con el link como parámetro {{1}} del cuerpo.
 */
const GRAPH = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');

const enviar = async (cred, destino, { cuerpo, link }) => {
  if (!cred?.phone_number_id || !cred?.access_token) throw new Error('Credenciales de Meta incompletas');
  const to = destino.replace('+', '');
  const payload = cred.template
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: cred.template,
          language: { code: cred.idioma || 'es_AR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: link || cuerpo }] }],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: true, body: cuerpo } };

  const res = await fetch(`${GRAPH()}/${cred.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cred.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Meta respondió ${res.status}`);
  return { id: data.messages?.[0]?.id || null };
};

/** Verifica que el phone_number_id y el token sean válidos. */
const verificar = async (cred) => {
  const res = await fetch(`${GRAPH()}/${cred.phone_number_id}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${cred.access_token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Meta respondió ${res.status}`);
  return data;
};

module.exports = { nombre: 'meta', enviar, verificar };
