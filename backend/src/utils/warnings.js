/**
 * Silencia únicamente el ExperimentalWarning "Importing JSON modules…".
 *
 * Nuestro código no importa JSON: lo hace internamente el paquete baileys (ESM, `with { type: 'json' }`).
 * En Node 22.11 ese import emite el aviso aunque use la sintaxis vigente, y la sintaxis antigua
 * `assert { type: 'json' }` ya no existe (SyntaxError). Cualquier otro warning se sigue mostrando.
 * Debe cargarse antes que cualquier otro módulo.
 */
const emitirOriginal = process.emitWarning;

process.emitWarning = function emitWarning(warning, ...args) {
  const tipo = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  const mensaje = typeof warning === 'string' ? warning : warning?.message;
  if (tipo === 'ExperimentalWarning' && /Importing JSON modules/.test(mensaje || '')) return;
  return emitirOriginal.call(process, warning, ...args);
};
