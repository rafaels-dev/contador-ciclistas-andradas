import Link from "next/link";
import { connection } from "next/server";
import { tarefasEmAndamento } from "@/lib/atividade";
import { AutoRefresh } from "../jobs/[id]/auto-refresh";

/** Rodapé com a tarefa principal em andamento (a lista completa fica na barra lateral). */
export async function BarraStatus() {
  await connection();
  const tarefas = tarefasEmAndamento();
  const principal = tarefas[0];
  const p = principal?.progresso ?? 0;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-xs text-muted" data-testid="barra-status">
      {tarefas.length > 0 && <AutoRefresh ms={3000} />}
      {principal ? (
        <>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          <Link href={principal.href} className="flex min-w-0 items-center gap-2 hover:text-fg">
            <span className="shrink-0">{principal.etapa}</span>
            <span className="truncate text-fg">{principal.nome}</span>
            {principal.progresso !== null && (
              <>
                <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-line">
                  <span className="block h-full bg-accent" style={{ width: `${Math.round(p * 100)}%` }} />
                </span>
                <span className="font-mono tabular-nums">{Math.round(p * 100)}%</span>
              </>
            )}
          </Link>
          {tarefas.length > 1 && <span className="shrink-0">+{tarefas.length - 1} em andamento</span>}
        </>
      ) : (
        <span>Nada em andamento</span>
      )}
    </footer>
  );
}
