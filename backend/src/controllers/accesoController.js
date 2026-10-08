const pool = require('../config/db');
const { validarCodigo } = require('../services/validacionAcceso');
const { AppError, asyncHandler } = require('../utils/errors');

/** Lee y sanea { codigo | qr_code, id_evento? } del cuerpo. */
const leerPedido = (req) => {
  const codigo = String(req.body.codigo ?? req.body.qr_code ?? '').trim();
  if (!codigo) throw new AppError(400, 'Código requerido');
  if (codigo.length > 64) throw new AppError(400, 'Código inválido');
  const idEvento = req.body.id_evento ? Number(req.body.id_evento) : null;
  return { codigo, idEvento, idTenant: req.tenant.id_tenant, idValidador: req.usuario.id_usuario };
};

/**
 * POST /api/porteria/validarQR { codigo | qr_code, id_evento? }   (sólo porteros)
 * Valida el QR contra las inscripciones del complejo (eventos_inscripciones = tickets).
 *   permitido: true  → "Entrada permitida"; la entrada queda marcada como ingresada.
 *   permitido: false → "Entrada denegada"; `estado` y `motivo` dicen por qué (ya_usado, invalido / caducada).
 */
const ESTADO = { valido: 'ingresado', usado: 'ya_usado', invalido: 'invalido' };
exports.validarQR = asyncHandler(async (req, res) => {
  const r = await validarCodigo(leerPedido(req));
  const permitido = r.resultado === 'valido';
  res.json({
    permitido,
    valido: permitido,
    mensaje: permitido ? 'Entrada permitida' : 'Entrada denegada',
    estado: ESTADO[r.resultado],
    ...r,
  });
});

/** GET /api/porteria/eventos — eventos del complejo que se pueden controlar (próximos y en curso). */
exports.eventosPorteria = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_evento, nombre, fecha FROM eventos
      WHERE id_tenant = ? AND estado <> 'cancelado' AND fecha >= NOW() - INTERVAL 12 HOUR
      ORDER BY fecha LIMIT 50`,
    [req.tenant.id_tenant]
  );
  res.json(rows);
});

/**
 * Últimas lecturas del complejo (de todos sus porteros).
 * GET /api/porteria/historial (portero) y GET /api/acceso/historial (admin).
 */
exports.historial = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id_acceso, a.codigo_leido, a.resultado, a.fecha, CONCAT_WS(' ', u.nombre, u.apellido) AS validador, e.nombre AS evento
       FROM accesos a
       JOIN usuarios u ON u.id_usuario = a.id_validador
       LEFT JOIN administradores ad ON ad.id_usuario = a.id_validador
       LEFT JOIN porteros po ON po.id_usuario = a.id_validador
       LEFT JOIN tickets t ON t.id_ticket = a.id_ticket
       LEFT JOIN tipos_ticket tt ON tt.id_tipo = t.id_tipo
       LEFT JOIN eventos e ON e.id_evento = tt.id_evento
      WHERE ad.id_tenant = ? OR po.id_tenant = ? OR e.id_tenant = ?
      ORDER BY a.fecha DESC, a.id_acceso DESC LIMIT 100`,
    [req.tenant.id_tenant, req.tenant.id_tenant, req.tenant.id_tenant]
  );
  res.json(rows);
});
