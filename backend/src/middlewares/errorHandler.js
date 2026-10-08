const { AppError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
module.exports = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Registro duplicado (asiento, email, DNI o código ya en uso)' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
};
