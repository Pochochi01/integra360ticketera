/**
 * Copia el texto de cada <th> como data-label de las celdas de su columna en todas las tablas .tabla, para
 * que en celulares se muestren como tarjetas «Etiqueta ··· valor» (CSS en index.css). Observa el DOM, así
 * cubre tablas que se renderizan o actualizan después (paginado, refresco cada 10 s, filtros).
 * Encabezados vacíos (columna de acciones) no generan etiqueta: esas celdas ocupan el ancho completo.
 */
const etiquetar = (tabla) => {
  const ths = [...tabla.querySelectorAll('thead th')];
  if (!ths.length) return;
  const etiquetas = ths.map((th) => th.textContent.trim());
  for (const tr of tabla.querySelectorAll('tbody tr')) {
    let col = 0;
    for (const td of tr.children) {
      const etiqueta = etiquetas[col];
      if (etiqueta && !td.hasAttribute('colspan')) {
        if (td.dataset.label !== etiqueta) td.dataset.label = etiqueta;
      } else if (td.dataset.label) {
        delete td.dataset.label;
      }
      col += Number(td.getAttribute('colspan') || 1);
    }
  }
};

export const iniciarTablasResponsivas = () => {
  let pendiente = false;
  const recorrer = () => {
    pendiente = false;
    document.querySelectorAll('table.tabla').forEach(etiquetar);
  };
  // Agrupa las mutaciones de un mismo cuadro: React puede tocar muchas celdas a la vez
  new MutationObserver(() => {
    if (!pendiente) { pendiente = true; requestAnimationFrame(recorrer); }
  }).observe(document.body, { childList: true, subtree: true });
  recorrer();
};
