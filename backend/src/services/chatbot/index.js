const { Chatbot } = require('../../models/Integracion');
const meta = require('./metaProvider');
const baileys = require('./baileysManager');

/**
 * Envío de WhatsApp por tenant: usa el chatbot que el superadmin configuró para ese complejo (Meta o Baileys).
 * Si el complejo no tiene chatbot, se usa el proveedor de respaldo global (WHATSAPP_FALLBACK):
 *  - console (por defecto): imprime el mensaje (desarrollo)
 *  - none: falla, obligando a configurar un chatbot
 */
const consola = {
  nombre: 'console',
  async enviar(_cred, destino, { cuerpo }) {
    console.log(`\n[whatsapp → ${destino}]\n${cuerpo}\n`);
    return { id: `console-${Date.now()}` };
  },
};

/** Devuelve { provider, enviar(destino, mensaje) } listo para usar según el tenant. */
const resolver = async (idTenant) => {
  const integracion = await Chatbot.obtener(idTenant);
  if (integracion?.activo) {
    if (integracion.provider === 'meta') {
      return { provider: 'meta', enviar: (destino, msg) => meta.enviar(integracion.credentials, destino, msg) };
    }
    return { provider: 'baileys', enviar: (destino, msg) => baileys.enviar(idTenant, destino, msg) };
  }
  if ((process.env.WHATSAPP_FALLBACK || 'console') === 'none') {
    return { provider: 'ninguno', enviar: async () => { throw new Error('El complejo no tiene un chatbot de WhatsApp configurado'); } };
  }
  return { provider: 'console', enviar: (destino, msg) => consola.enviar(null, destino, msg) };
};

/** Estado resumido para mostrar si el complejo puede enviar mensajes. */
const disponible = async (idTenant) => {
  const i = await Chatbot.obtener(idTenant);
  if (!i?.activo) return { disponible: (process.env.WHATSAPP_FALLBACK || 'console') !== 'none', provider: i ? i.provider : 'console', estado: i?.estado || 'sin_configurar' };
  const estado = i.provider === 'baileys' ? baileys.estadoDe(idTenant).estado : i.estado;
  return { disponible: estado === 'conectado', provider: i.provider, estado };
};

module.exports = { resolver, disponible, meta, baileys };
