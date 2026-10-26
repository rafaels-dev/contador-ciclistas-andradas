import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { renderTrabalhando } from "@/lib/atividade";
import { listarRenders } from "@/lib/db";
import { AutoRefresh } from "../jobs/[id]/auto-refresh";

const STATUS = { na_fila: "Na fila", renderizando: "Gerando", pronto: "Pronto", erro: "Erro" } as const;
const COR = { na_fila: "text-muted", renderizando: "text-accent-text", pronto: "text-ok", erro: "text-danger" } as const;

/** "2026-10-23 14:05:00" (UTC, do SQLite) → "23/10 11:05" no horário de Brasília. */
function quando(utc: string): string {
  return new Date(`${utc.replace(" ", "T")}Z`).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function PaginaRenders() {
  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">Exportações</h1>
        <p className="text-sm text-muted">Vídeos finais gerados. Para montar um novo, marque os vídeos revisados na biblioteca.</p>
      </header>
      <Suspense fallback={<p className="text-muted">Carregando…</p>}>
        <Lista />
      </Suspense>
    </div>
  );
}

async function Lista() {
  await connection();
  const renders = listarRenders();
  if (!renders.length) return <p className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-muted">Nenhum vídeo final ainda.</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
      {renders.some(renderTrabalhando) && <AutoRefresh ms={2000} />}
      {renders.map((r) => {
        const n = (JSON.parse(r.jobs) as string[]).length;
        return (
          <li key={r.id}>
            <Link href={`/renders/${r.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-hover">
              <span className="flex items-center gap-4">
                <span className="flex-1 truncate font-medium">{r.nome}</span>
                <span className="shrink-0 font-mono text-xs text-faint">
                  {n} {n === 1 ? "vídeo" : "vídeos"} · {quando(r.criado_em)}
                </span>
                <span className={`w-16 shrink-0 text-right text-sm font-medium ${COR[r.status]}`}>{STATUS[r.status]}</span>
              </span>
              {renderTrabalhando(r) && (
                <span className="flex items-center gap-3 text-xs text-muted" data-testid="progresso">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full bg-accent" style={{ width: `${Math.round(r.progresso * 100)}%` }} />
                  </span>
                  <span className="font-mono tabular-nums">{r.mensagem}</span>
                </span>
              )}
              {r.status === "pronto" && r.mensagem && <span className="text-xs text-muted">{r.mensagem}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
