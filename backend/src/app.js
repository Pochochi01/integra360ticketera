const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));
app.use(express.json({ limit: '100kb' }));

// Imágenes subidas (eventos). Sólo archivos generados por el servidor, sin listado de directorio.
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { index: false, dotfiles: 'deny', maxAge: '7d' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', routes);
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(errorHandler);

module.exports = app;
