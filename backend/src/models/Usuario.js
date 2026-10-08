const pool = require('../config/db');

/**
 * Persona + credenciales. La pertenencia a un complejo NO se guarda acá (3FN):
 *  - administradores(id_usuario, id_tenant)
 *  - vendedores(id_vendedor, id_tenant, id_usuario, estado)
 *  - porteros(id_portero, id_tenant, id_usuario, usuario, estado)
 * El id_tenant que devuelve este modelo se calcula a partir de esas tablas.
 */
const SELECT = `
  SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.dni, u.whatsapp, u.rol, u.creado_en,
         COALESCE(a.id_tenant, vd.id_tenant, po.id_tenant) AS id_tenant, vd.id_vendedor,
         po.id_portero, po.usuario,
         t.nombre AS tenant, t.slug AS tenant_slug
    FROM usuarios u
    LEFT JOIN administradores a ON a.id_usuario = u.id_usuario
    LEFT JOIN vendedores vd ON vd.id_usuario = u.id_usuario
    LEFT JOIN porteros po ON po.id_usuario = u.id_usuario
    LEFT JOIN tenants t ON t.id_tenant = COALESCE(a.id_tenant, vd.id_tenant, po.id_tenant)`;

const Usuario = {
  findAll: async ({ id_tenant, rol } = {}) => {
    const filtros = [];
    const params = [];
    if (id_tenant) { filtros.push('COALESCE(a.id_tenant, vd.id_tenant, po.id_tenant) = ?'); params.push(id_tenant); }
    if (rol) { filtros.push('u.rol = ?'); params.push(rol); }
    return (await pool.query(`${SELECT} ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''} ORDER BY u.id_usuario`, params))[0];
  },

  findById: async (id, db = pool) => (await db.query(`${SELECT} WHERE u.id_usuario = ?`, [id]))[0][0],

  findByEmail: async (email, db = pool) => (await db.query(`${SELECT} WHERE u.email = ?`, [email]))[0][0],

  findByEmailConPassword: async (email) => (await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]))[0][0],

  /** Login: con '@' busca por email; si no, por el nombre de usuario de un portero. */
  findByLoginConPassword: async (login) => {
    const valor = String(login).trim().toLowerCase();
    if (valor.includes('@')) return Usuario.findByEmailConPassword(valor);
    return (await pool.query('SELECT u.* FROM usuarios u JOIN porteros po ON po.id_usuario = u.id_usuario WHERE po.usuario = ?', [valor]))[0][0];
  },

  existeEmail: async (email, excluirId = 0) =>
    (await pool.query('SELECT 1 FROM usuarios WHERE email = ? AND id_usuario <> ?', [email, excluirId]))[0].length > 0,

  /** DNI repetido entre compradores (el personal puede repetir DNI entre complejos). */
  existeDniComprador: async (dni, excluirId = 0) =>
    !!dni &&
    (await pool.query("SELECT 1 FROM usuarios WHERE dni = ? AND rol = 'comprador' AND id_usuario <> ?", [dni, excluirId]))[0].length > 0,

  create: async ({ nombre, apellido = null, email, dni = null, whatsapp = null, password_hash, rol = 'comprador' }, db = pool) => {
    const [r] = await db.query(
      'INSERT INTO usuarios (nombre, apellido, email, dni, whatsapp, password_hash, rol) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, apellido, email, dni || null, whatsapp, password_hash, rol]
    );
    return r.insertId;
  },

  update: async (id, datos, db = pool) => {
    const permitidos = ['nombre', 'apellido', 'email', 'dni', 'whatsapp', 'rol', 'password_hash'];
    const campos = Object.keys(datos).filter((k) => permitidos.includes(k) && datos[k] !== undefined);
    if (campos.length) {
      await db.query(`UPDATE usuarios SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id_usuario = ?`, [
        ...campos.map((c) => datos[c]),
        id,
      ]);
    }
    return Usuario.findById(id, db);
  },

  /** Asigna (o reasigna) el complejo que administra un usuario; null lo quita. */
  setTenantAdministrado: async (id, idTenant, db = pool) => {
    if (idTenant) {
      await db.query(
        'INSERT INTO administradores (id_usuario, id_tenant) VALUES (?, ?) ON DUPLICATE KEY UPDATE id_tenant = VALUES(id_tenant)',
        [id, idTenant]
      );
    } else {
      await db.query('DELETE FROM administradores WHERE id_usuario = ?', [id]);
    }
  },

  remove: (id, db = pool) => db.query('DELETE FROM usuarios WHERE id_usuario = ?', [id]),
};

module.exports = Usuario;
