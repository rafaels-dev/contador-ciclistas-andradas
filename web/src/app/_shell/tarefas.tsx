import Link from "next/link";
import type { Tarefa } from "@/lib/atividade";
import { TITULO_PAINEL } from "@/lib/ui";

/** Painel da barra lateral: tudo o que está rodando, com progresso; clicar abre o vídeo. */
export function PainelTarefas({ tarefas }: { tarefas: Tarefa[] }) {
  const rodando = tarefas.filter((t) => !t.naFila).length;
  return (
    <section className="flex min-h-0 flex-col gap-1" aria-label="Tarefas em andamento" data-testid="tarefas">
      <h2 className={`${TITULO_PAINEL} flex items-center gap-2 px-2 pb-1`}>
        Tarefas em andamento
        {tarefas.length > 0 && (
          <span className="rounded bg-accent px-1 font-mono text-[0.65rem] font-semibold text-accent-ink">{tarefas.length}</span>
        )}
      </h2>
      {tarefas.length === 0 ? (
        <p className="px-2 text-xs text-faint">Nada rodando agora.</p>
      ) : (
        <>
          {tarefas.length > rodando && (
            <p className="px-2 text-[0.7rem] text-faint">
              {rodando} rodando · {tarefas.length - rodando} na fila
            </p>
          )}
          <ul className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto">
            {tarefas.map((t) => (
              <li key={t.chave}>
                <Link href={t.href} className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-hover" title={t.mensagem ?? undefined}>
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.naFila ? "bg-faint" : "animate-pulse bg-accent"}`} aria-hidden />
                    <span className="truncate text-xs font-medium">{t.nome}</span>
                  </span>
                  <span className="flex items-center gap-2 pl-3 text-[0.7rem] text-muted">
                    <span className="truncate">{t.etapa}</span>
                    {t.progresso !== null && t.progresso > 0 && <span className="ml-auto shrink-0 font-mono tabular-nums">{Math.round(t.progresso * 100)}%</span>}
                  </span>
                  {!t.naFila && (
                    <span className={`ml-3 h-1 overflow-hidden rounded-full bg-line ${t.progresso === null ? "barra-indeterminada" : ""}`}>
                      {t.progresso !== null && <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(t.progresso * 100)}%` }} />}
                    </span>
                  )}
                  {t.mensagem && !t.naFila && <span className="truncate pl-3 font-mono text-[0.65rem] text-faint">{t.mensagem}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
