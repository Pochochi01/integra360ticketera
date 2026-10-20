const pool = require('../config/db');

/**
 * La configuración del complejo se guarda en columnas atómicas (mensaje_whatsapp, color_primario, logo_url).
 * Hacia la API se sigue exponiendo agrupada en `config` para no acoplar el frontend al esquema.
 */
const CONFIG = ['mensaje_whatsapp', 'color_primario', 'logo_url'];

const mapear = (t) => {
  if (!t) return t;
  const config = {};
  for (const k of CONFIG) {
    config[k] = t[k];
    delete t[k];
  }
  return { ...t, config };
};

const SELECT = `
  SELECT t.*, s.estado AS suscripcion_estado, s.vence_el AS suscripcion_vence, p.nombre AS plan
    FROM tenants t
    LEFT JOIN suscripciones s ON s.id_tenant = t.id_tenant
    LEFT JOIN planes p ON p.id_plan = s.id_plan`;

const Tenant = {
  CONFIG,

  findAll: async () =>
    (await pool.query(
      `SELECT x.*,
              (SELECT COUNT(*) FROM eventos e WHERE e.id_tenant = x.id_tenant) AS eventos,
              (SELECT COUNT(*) FROM vendedores v WHERE v.id_tenant = x.id_tenant) AS vendedores,
              (SELECT COALESCE(SUM(v.monto_total),0) FROM ventas v JOIN eventos e ON e.id_evento = v.id_evento
                WHERE e.id_tenant = x.id_tenant AND v.estado = 'pagado') AS recaudado,
              (SELECT provider FROM chatbot_integrations c WHERE c.id_tenant = x.id_tenant) AS chatbot_provider,
              (SELECT estado FROM chatbot_integrations c WHERE c.id_tenant = x.id_tenant) AS chatbot_estado,
              (SELECT m.activo AND m.estado = 'conectado' FROM mercadopago_tokens m WHERE m.id_tenant = x.id_tenant) AS mercadopago_activo,
              (SELECT m.correo_vinculado FROM mercadopago_tokens m WHERE m.id_tenant = x.id_tenant) AS mercadopago_correo
         FROM (${SELECT}) x ORDER BY x.nombre`
    ))[0].map(mapear),

  /** Datos públicos de los tenants activos (selector de complejos). */
  findActivosPublico: async () =>
    (await pool.query("SELECT id_tenant, nombre, slug, direccion, color_primario, logo_url FROM tenants WHERE estado = 'activo' ORDER BY nombre"))[0],

  findById: async (id, db = pool) => mapear((await db.query(`${SELECT} WHERE t.id_tenant = ?`, [id]))[0][0]),

  findBySlug: async (slug) => mapear((await pool.query(`${SELECT} WHERE t.slug = ?`, [slug]))[0][0]),

  create: async (d, db = pool) => {
    const c = d.config || {};
    const [r] = await db.query(
      `INSERT INTO tenants (nombre, slug, email_contacto, telefono, direccion, mensaje_whatsapp, color_primario, logo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.nombre, d.slug, d.email_contacto || null, d.telefono || null, d.direccion || null,
        c.mensaje_whatsapp || null, c.color_primario || null, c.logo_url || null]
    );
    return r.insertId;
  },

  update: async (id, d) => {
    const valores = { ...d, ...(d.config || {}) };
    delete valores.config;
    const permitidos = ['nombre', 'slug', 'email_contacto', 'telefono', 'direccion', 'estado', ...CONFIG];
    const campos = Object.keys(valores).filter((k) => permitidos.includes(k) && valores[k] !== undefined);
    if (campos.length) {
      await pool.query(`UPDATE tenants SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id_tenant = ?`, [
        ...campos.map((c) => (valores[c] === '' ? null : valores[c])),
        id,
      ]);
    }
    return Tenant.findById(id);
  },
};

module.exports = Tenant;
