/** Plano de asientos agrupado por sector y fila. Solo permite elegir asientos de tipos seleccionables. */
export default function SeatMap({ asientos, seleccion, onToggle, tiposPermitidos }) {
  const sectores = {};
  for (const a of asientos) {
    sectores[a.sector] ??= {};
    (sectores[a.sector][a.fila] ??= []).push(a);
  }

  return (
    <div className="space-y-5">
      <div className="mx-auto w-2/3 rounded-b-3xl bg-zinc-800 dark:bg-zinc-700 py-1 text-center text-xs tracking-widest text-white">ESCENARIO</div>
      {Object.entries(sectores).map(([sector, filas]) => (
        <div key={sector}>
          <h4 className="mb-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400">{sector}</h4>
          <div className="space-y-1.5 overflow-x-auto">
            {Object.entries(filas).map(([fila, lista]) => (
              <div key={fila} className="flex items-center gap-1.5">
                <span className="w-5 text-xs font-medium text-zinc-400 dark:text-zinc-500">{fila}</span>
                {lista.map((a) => {
                  const elegido = seleccion.includes(a.id_asiento);
                  const bloqueado = a.ocupado || !tiposPermitidos.includes(a.id_tipo);
                  return (
                    <button
                      key={a.id_asiento}
                      type="button"
                      disabled={bloqueado}
                      title={a.etiqueta}
                      onClick={() => onToggle(a)}
                      className={`h-7 w-7 shrink-0 rounded-t-lg text-[10px] font-semibold transition ${
                        a.ocupado
                          ? 'cursor-not-allowed bg-zinc-300 dark:bg-white/20 text-zinc-400 dark:text-zinc-500'
                          : elegido
                            ? 'bg-indigo-600 text-white'
                            : bloqueado
                              ? 'cursor-not-allowed bg-zinc-100 dark:bg-white/10 text-zinc-300 dark:text-zinc-600'
                              : 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-300'
                      }`}
                    >
                      {a.numero}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-emerald-100 dark:bg-emerald-500/15" /> Libre</span>
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-indigo-600" /> Seleccionado</span>
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-zinc-300 dark:bg-white/20" /> Ocupado</span>
      </div>
    </div>
  );
}
