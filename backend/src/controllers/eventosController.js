const pool = require('../config/db');
const Evento = require('../models/Evento');
const TipoTicket = require('../models/TipoTicket');
const Asiento = require('../models/Asiento');
const ListaEspera = require('../models/ListaEspera');
const { liberarVenta } = require('./ventasController');
const { metodosDisponibles } = require('../services/pagosService');
const { guardarImagenEvento, borrarImagen } = require('../middlewares/subidaImagen');
const { AppError, asyncHandler } = require('../utils/errors');
const { asegurarTenant } = require('../middlewares/tenant');

/** Carga el evento y verifica que sea del tenant de la sesión. */
const eventoDelTenant = async (id, req) => asegurarTenant(await Evento.findById(id), req, 'Evento no encontrado');

/** Carga el tipo de ticket y verifica (vía su evento) que sea del tenant de la sesión. */
const tipoDelTenant = async (idTipo, req) => {
  const tipo = await TipoTicket.findById(idTipo);
  if (!tipo) throw new AppError(404, 'Tipo de ticket no encontrado');
  await eventoDelTenant(tipo.id_evento, req);
  return tipo;
};

const ESTADOS = ['borrador', 'publicado', 'agotado', 'cancelado', 'finalizado'];

const validarEvento = (d, parcial = false) => {
  if (!parcial && (!d.nombre?.trim() || !d.fecha || !d.lugar?.trim())) throw new AppError(400, 'Nombre, fecha y lugar son obligatorios');
  if (d.nombre !== undefined && (!String(d.nombre).trim() || String(d.nombre).length > 160)) throw new AppError(400, 'Nombre inválido');
  if (d.lugar !== undefined && (!String(d.lugar).trim() || String(d.lugar).length > 200)) throw new AppError(400, 'Lugar inválido');
  if (d.fecha && Number.isNaN(Date.parse(d.fecha))) throw new AppError(400, 'Fecha inválida');
  if (!parcial && new Date(d.fecha) < new Date()) throw new AppError(400, 'La fecha del evento debe ser futura');
  if (d.limite_por_persona && (!Number.isInteger(Number(d.limite_por_persona)) || Number(d.limite_por_persona) < 1)) {
    throw new AppError(400, 'El límite por persona debe ser un entero positivo (o vacío para sin límite)');
  }
  if (d.estado && !ESTADOS.includes(d.estado)) throw new AppError(400, 'Estado inválido');
  if (d.estado === 'cancelado') throw new AppError(400, 'Use POST /eventos/:id/cancelar para cancelar un evento');
};

const validarTipo = (d, parcial = false) => {
  if (!parcial && (!d.nombre_tipo || d.precio === undefined || d.stock_total === undefined)) {
    throw new AppError(400, 'nombre_tipo, precio y stock_total son obligatorios');
  }
  if (d.precio !== undefined && (Number.isNaN(Number(d.precio)) || Number(d.precio) < 0)) throw new AppError(400, 'Precio inválido');
  if (d.stock_total !== undefined && (!Number.isInteger(Number(d.stock_total)) || Number(d.stock_total) < 0)) {
    throw new AppError(400, 'Stock inválido');
  }
  if (d.nombre_tipo !== undefined && (!String(d.nombre_tipo).trim() || String(d.nombre_tipo).length > 80)) throw new AppError(400, 'Nombre de tipo inválido');
  if (d.venta_desde && d.venta_hasta && new Date(d.venta_desde) > new Date(d.venta_hasta)) {
    throw new AppError(400, 'El inicio de venta debe ser anterior al fin');
  }
};

// ---------- Eventos ----------

/** Público: eventos del tenant identificado (subdominio / X-Tenant) o de todos los tenants. */
exports.listar = asyncHandler(async (req, res) => res.json(await Evento.findAll({ id_tenant: req.tenantPublico?.id_tenant })));

exports.listarTodos = asyncHandler(async (req, res) =>
  res.json(await Evento.findAll({ id_tenant: req.tenant.id_tenant, incluirNoPublicados: true }))
);

exports.detalle = asyncHandler(async (req, res) => {
  const evento = await Evento.findById(req.params.id);
  if (!evento) throw new AppError(404, 'Evento no encontrado');
  const esAdmin =
    req.usuario?.rol === 'superadmin' || (req.usuario?.rol === 'admin' && req.usuario.id_tenant === evento.id_tenant);
  if (evento.estado_tenant !== 'activo' && !esAdmin) throw new AppError(404, 'Evento no encontrado');
  if (req.tenantPublico && req.tenantPublico.id_tenant !== evento.id_tenant) throw new AppError(404, 'Evento no encontrado');
  if (evento.estado === 'borrador' && !esAdmin) throw new AppError(404, 'Evento no encontrado');
  const tipos = await TipoTicket.findByEvento(evento.id_evento, { incluirSoloAdmin: esAdmin });
  const asientos = evento.tiene_seating ? await Asiento.findByEvento(evento.id_evento) : [];
  res.json({ ...evento, tipos, asientos, metodos_pago: await metodosDisponibles(evento.id_tenant) });
});

exports.crear = asyncHandler(async (req, res) => {
  validarEvento(req.body);
  // Permite crear los tipos de ticket en el mismo request: se validan todos antes de crear nada
  const tipos = req.body.tipos || [];
  tipos.forEach((t) => validarTipo(t));
  const evento = await Evento.create(req.tenant.id_tenant, req.body);
  for (const tipo of tipos) await TipoTicket.create(evento.id_evento, tipo);
  res.status(201).json({ ...evento, tipos: await TipoTicket.findByEvento(evento.id_evento, { incluirSoloAdmin: true }) });
});

exports.actualizar = asyncHandler(async (req, res) => {
  validarEvento(req.body, true);
  const actual = await eventoDelTenant(req.params.id, req);
  if (actual.estado === 'cancelado') throw new AppError(409, 'El evento está cancelado');
  res.json(await Evento.update(req.params.id, req.body));
});

exports.eliminar = asyncHandler(async (req, res) => {
  const evento = await eventoDelTenant(req.params.id, req);
  if (await Evento.tieneVentas(req.params.id)) throw new AppError(409, 'El evento tiene ventas; cancélelo en lugar de eliminarlo');
  if (!(await Evento.remove(req.params.id))) throw new AppError(404, 'Evento no encontrado');
  borrarImagen(evento.imagen_evento);
  res.status(204).end();
});

/** Cancela el evento: ventas pagadas → reembolsadas, pendientes → canceladas. */
exports.cancelar = asyncHandler(async (req, res) => {
  const resumen = await pool.withTransaction(async (conn) => {
    const [[evento]] = await conn.query('SELECT * FROM eventos WHERE id_evento = ? FOR UPDATE', [req.params.id]);
    asegurarTenant(evento, req, 'Evento no encontrado');
    if (evento.estado === 'cancelado') throw new AppError(409, 'El evento ya está cancelado');
    const [ventas] = await conn.query(
      "SELECT * FROM ventas WHERE id_evento = ? AND estado IN ('pendiente','pagado') FOR UPDATE",
      [evento.id_evento]
    );
    for (const v of ventas) await liberarVenta(conn, v, v.estado === 'pagado' ? 'reembolsado' : 'cancelado');
    await conn.query("UPDATE eventos SET estado = 'cancelado' WHERE id_evento = ?", [evento.id_evento]);
    await conn.query(
      "UPDATE lista_espera le JOIN tipos_ticket tt ON tt.id_tipo = le.id_tipo SET le.estado = 'cancelado' WHERE tt.id_evento = ?",
      [evento.id_evento]
    );
    return {
      reembolsadas: ventas.filter((v) => v.estado === 'pagado').length,
      canceladas: ventas.filter((v) => v.estado === 'pendiente').length,
    };
  });
  res.json({ mensaje: 'Evento cancelado', ...resumen });
});

// ---------- Tipos de ticket ----------

exports.crearTipo = asyncHandler(async (req, res) => {
  validarTipo(req.body);
  const evento = await eventoDelTenant(req.params.id, req);
  const tipo = await TipoTicket.create(evento.id_evento, req.body);
  await Evento.actualizarEstadoPorStock(evento.id_evento);
  res.status(201).json(tipo);
});

exports.actualizarTipo = asyncHandler(async (req, res) => {
  validarTipo(req.body, true);
  const antes = await tipoDelTenant(req.params.idTipo, req);
  const tipo = await TipoTicket.update(req.params.idTipo, req.body);
  if (tipo.error) throw new AppError(409, tipo.error);
  const liberado = tipo.stock_disponible - antes.stock_disponible;
  if (liberado > 0) await ListaEspera.notificarLiberacion(tipo.id_tipo, liberado);
  await Evento.actualizarEstadoPorStock(tipo.id_evento);
  res.json(tipo);
});

exports.eliminarTipo = asyncHandler(async (req, res) => {
  const tipo = await tipoDelTenant(req.params.idTipo, req);
  if (await TipoTicket.tieneTickets(tipo.id_tipo)) {
    await TipoTicket.update(tipo.id_tipo, { activo: false });
    return res.json({ mensaje: 'El tipo tiene tickets emitidos: se desactivó en lugar de eliminarse' });
  }
  await TipoTicket.remove(tipo.id_tipo);
  res.status(204).end();
});

// ---------- Asientos ----------

exports.listarAsientos = asyncHandler(async (req, res) => res.json(await Asiento.findByEvento(req.params.id)));

/** POST /eventos/:id/asientos { id_tipo, sector, filas: ["A","B"], asientos_por_fila: 10 } */
exports.generarAsientos = asyncHandler(async (req, res) => {
  const { sector, filas, asientos_por_fila, id_tipo } = req.body;
  const porFila = Number(asientos_por_fila);
  const filasLimpias = Array.isArray(filas) ? filas.map((f) => String(f).trim().toUpperCase()).filter(Boolean) : [];
  if (!String(sector || '').trim() || !filasLimpias.length || !Number.isInteger(porFila) || porFila < 1 || porFila > 200) {
    throw new AppError(400, 'sector, filas[] y asientos_por_fila (1 a 200) son obligatorios');
  }
  if (filasLimpias.some((f) => f.length > 10)) throw new AppError(400, 'Nombre de fila demasiado largo');
  const evento = await eventoDelTenant(req.params.id, req);
  if (!evento.tiene_seating) throw new AppError(409, 'El evento no tiene seating plan habilitado');
  // Cada asiento pertenece a un tipo de ticket (y por él, al evento)
  const tipo = await TipoTicket.findById(id_tipo);
  if (!tipo || tipo.id_evento !== evento.id_evento) throw new AppError(400, 'Elegí un tipo de ticket del evento');
  const creados = await Asiento.generar(tipo.id_tipo, { sector: String(sector).trim(), filas: filasLimpias, asientos_por_fila: porFila });
  res.status(201).json({ creados });
});

// ---------- Imagen del evento ----------

/** POST /eventos/:id/imagen (multipart, campo "imagen") — la procesa y reemplaza la anterior. */
exports.subirImagen = asyncHandler(async (req, res) => {
  const evento = await eventoDelTenant(req.params.id, req);
  if (!req.file) throw new AppError(400, 'Adjuntá una imagen (JPG, PNG o WEBP, máx. 3 MB)');
  const ruta = await guardarImagenEvento(req.file.buffer);
  await Evento.setImagen(evento.id_evento, ruta);
  borrarImagen(evento.imagen_evento);
  res.json({ imagen_evento: ruta });
});

exports.quitarImagen = asyncHandler(async (req, res) => {
  const evento = await eventoDelTenant(req.params.id, req);
  await Evento.setImagen(evento.id_evento, null);
  borrarImagen(evento.imagen_evento);
  res.status(204).end();
});

// ---------- Lista de espera ----------

exports.unirseListaEspera = asyncHandler(async (req, res) => {
  const tipo = await TipoTicket.findById(req.params.idTipo);
  if (!tipo || tipo.solo_admin || !tipo.activo) throw new AppError(404, 'Tipo de ticket no encontrado');
  if (req.usuario.rol !== 'comprador') throw new AppError(403, 'Solo los compradores pueden anotarse en la lista de espera');
  const cantidad = Number(req.body.cantidad || 1);
  if (!Number.isInteger(cantidad) || cantidad < 1) throw new AppError(400, 'Cantidad inválida');
  if (tipo.stock_disponible >= cantidad) throw new AppError(409, 'Hay stock disponible: puede comprar directamente');
  await ListaEspera.inscribir(tipo.id_tipo, req.usuario.id_usuario, cantidad);
  res.status(201).json({ mensaje: 'Inscripto en la lista de espera. Le avisaremos cuando se liberen tickets.' });
});

exports.miListaEspera = asyncHandler(async (req, res) => res.json(await ListaEspera.findByUsuario(req.usuario.id_usuario)));

exports.salirListaEspera = asyncHandler(async (req, res) => {
  if (!(await ListaEspera.cancelar(req.params.idEspera, req.usuario.id_usuario))) throw new AppError(404, 'Inscripción no encontrada');
  res.status(204).end();
});

exports.listaEsperaPorTipo = asyncHandler(async (req, res) => {
  await tipoDelTenant(req.params.idTipo, req);
  res.json(await ListaEspera.findByTipo(req.params.idTipo));
});
