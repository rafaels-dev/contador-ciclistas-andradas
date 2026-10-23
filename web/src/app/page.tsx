import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listarCandidatos, listarJobs, listarRenders, resumoRevisao, type Job } from "@/lib/db";
import { sugestoesAtivas } from "@/lib/runner";
import { rotuloStatus } from "@/lib/status";
import { AutoRefresh } from "./jobs/[id]/auto-refresh";
import { FormNovoJob } from "./form-novo-job";
import { SeletorLocal } from "./seletor-local";
import { SeletorVideoFinal, type OpcaoVideo } from "./seletor-video-final";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Contador de tráfego</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Cole o link de um vídeo do Google Drive ou escolha um vídeo do computador. O app detecta os objetos em movimento, pede uma
          sugestão de classificação ao modelo de visão e você confirma antes do vídeo final.
        </p>
      </header>

      <FormNovoJob />
      <SeletorLocal />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Jobs</h2>
        <Suspense fallback={<p className="text-zinc-500">Carregando…</p>}>
          <ListaJobs />
        </Suspense>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Vídeo final</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Marque um ou mais vídeos já revisados para gerar um único vídeo, com o contador somando entre eles
          (linhas com o mesmo nome somam juntas).
        </p>
        <Suspense fallback={<p className="text-zinc-500">Carregando…</p>}>
          <VideoFinal />
        </Suspense>
      </section>
    </main>
  );
}

/** Etapa em andamento (com processo vivo): mostra barra e mensagem e atualiza a página. */
function trabalhando(job: Job): boolean {
  return job.status === "baixando" || job.status === "detectando" || (job.status === "sugerindo" && sugestoesAtivas(job.id));
}

function Progresso({ progresso, mensagem }: { progresso: number; mensagem: string | null }) {
  return (
    <span className="flex flex-col gap-1" data-testid="progresso">
      <span className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <span className="block h-full bg-emerald-600 transition-all" style={{ width: `${Math.round(progresso * 100)}%` }} />
      </span>
      <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
        {mensagem} {progresso > 0 && `· ${Math.round(progresso * 100)}%`}
      </span>
    </span>
  );
}

async function ListaJobs() {
  await connection();
  const jobs = listarJobs();
  if (jobs.length === 0) return <p className="text-zinc-500">Nenhum job ainda.</p>;

  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {jobs.some(trabalhando) && <AutoRefresh ms={2000} />}
      {jobs.map((job) => (
        <li key={job.id}>
          <Link href={`/jobs/${job.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <span className="flex items-center justify-between gap-4">
              <span className="truncate">{job.nome_arquivo ?? job.drive_id}</span>
              <span className={`shrink-0 text-sm ${job.status === "erro" ? "text-red-600" : "text-zinc-500"}`}>{rotuloStatus(job)}</span>
            </span>
            {trabalhando(job) && <Progresso progresso={job.progresso} mensagem={job.mensagem} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const STATUS_RENDER = { na_fila: "na fila", renderizando: "gerando", pronto: "pronto", erro: "erro" } as const;

async function VideoFinal() {
  await connection();
  const opcoes: OpcaoVideo[] = listarJobs()
    .filter((j) => j.status === "sugerindo" || j.status === "aguardando_revisao")
    .map((j) => {
      const r = resumoRevisao(j.id);
      const motivo =
        j.status !== "aguardando_revisao" ? "aguardando sugestões" : r.revisados < r.total ? `faltam ${r.total - r.revisados} na revisão` : null;
      const contagens = listarCandidatos(j.id).filter((c) => c.rotulo && c.rotulo !== "descartado").length;
      return { id: j.id, nome: j.nome_arquivo ?? j.drive_id, motivo, contagens };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
  const renders = listarRenders();
  return (
    <>
      <SeletorVideoFinal opcoes={opcoes} />
      {renders.some((r) => r.status === "na_fila" || r.status === "renderizando") && <AutoRefresh ms={2000} />}
      {renders.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {renders.map((r) => (
            <li key={r.id}>
              <Link href={`/renders/${r.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="flex items-center justify-between gap-4">
                  <span className="truncate">{r.nome}</span>
                  <span className="shrink-0 text-sm text-zinc-500">{STATUS_RENDER[r.status]}</span>
                </span>
                {(r.status === "na_fila" || r.status === "renderizando") && <Progresso progresso={r.progresso} mensagem={r.mensagem} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
