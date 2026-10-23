import Link from "next/link";
import { connection } from "next/server";
import { jobTrabalhando, renderTrabalhando } from "@/lib/atividade";
import { listarJobs, listarRenders } from "@/lib/db";
import { rotuloStatus } from "@/lib/status";
import { AutoRefresh } from "../jobs/[id]/auto-refresh";

/** Rodapé com o que está rodando agora (download, detecção, sugestões, vídeo final). */
export async function BarraStatus() {
  await connection();
  const jobs = listarJobs().filter(jobTrabalhando);
  const renders = listarRenders().filter(renderTrabalhando);
  const tarefas = [
    ...renders.map((r) => ({ href: `/renders/${r.id}`, nome: r.nome, etapa: r.status === "na_fila" ? "Na fila" : "Vídeo final", p: r.progresso })),
    ...jobs.map((j) => ({ href: `/jobs/${j.id}`, nome: j.nome_arquivo ?? j.drive_id, etapa: rotuloStatus(j), p: j.progresso })),
  ];
  const principal = tarefas[0];

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-xs text-muted" data-testid="barra-status">
      {tarefas.length > 0 && <AutoRefresh ms={3000} />}
      {principal ? (
        <>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          <Link href={principal.href} className="flex min-w-0 items-center gap-2 hover:text-fg">
            <span className="shrink-0">{principal.etapa}</span>
            <span className="truncate text-fg">{principal.nome}</span>
            <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-line">
              <span className="block h-full bg-accent" style={{ width: `${Math.round(principal.p * 100)}%` }} />
            </span>
            <span className="font-mono tabular-nums">{Math.round(principal.p * 100)}%</span>
          </Link>
          {tarefas.length > 1 && <span className="shrink-0">+{tarefas.length - 1} em andamento</span>}
        </>
      ) : (
        <span>Nada em andamento</span>
      )}
    </footer>
  );
}
