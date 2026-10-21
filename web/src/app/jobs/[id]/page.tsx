import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listarCameras, listarCandidatos, obterJob, type Job, type Linha } from "@/lib/db";
import { sugestoesAtivas, temTrilhas } from "@/lib/runner";
import { cancelar, retomarSugestoes, tentarNovamente } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { BotaoEditarLinhas } from "./botao-editar-linhas";
import { EditorLinhas } from "./editor-linhas";
import { GradeCandidatos } from "./grade-candidatos";

const ROTULO_STATUS: Record<Job["status"], string> = {
  baixando: "Baixando",
  aguardando_linhas: "Defina as linhas de contagem",
  detectando: "Detectando objetos",
  sugerindo: "Sugestão de classificação",
  aguardando_revisao: "Aguardando revisão",
  renderizando: "Gerando vídeo final",
  concluido: "Concluído",
  erro: "Erro",
};

export default function PaginaJob(props: PageProps<"/jobs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Jobs
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Carregando…</p>}>
        <DetalheJob params={props.params} />
      </Suspense>
    </main>
  );
}

async function DetalheJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = obterJob(id);
  if (!job) notFound();
  const base = `/api/jobs/${job.id}/arquivos`;
  const sugerindoAgora = job.status === "sugerindo" && sugestoesAtivas(job.id);
  const trabalhando = job.status === "baixando" || job.status === "detectando" || sugerindoAgora;
  const linhas = JSON.parse(job.linhas) as Linha[];

  return (
    <section className="flex flex-col gap-6">
      {trabalhando && <AutoRefresh />}
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold break-all">{job.nome_arquivo ?? job.drive_id}</h1>
        <p className="text-sm text-zinc-500">
          {ROTULO_STATUS[job.status]}
          {job.duracao_s ? ` · ${Math.round(job.duracao_s / 60)} min de vídeo` : ""}
          {job.largura ? ` · ${job.largura}×${job.altura} @ ${job.fps?.toFixed(1)} fps` : ""}
        </p>
      </header>

      {trabalhando && (
        <div className="flex flex-col gap-2" data-testid="progresso">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${Math.round(job.progresso * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {job.mensagem} {job.progresso > 0 && `${Math.round(job.progresso * 100)}%`}
            </p>
            {!sugerindoAgora && (
              <form action={cancelar.bind(null, job.id)}>
                <button className="rounded-lg px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Cancelar</button>
              </form>
            )}
          </div>
        </div>
      )}

      {job.status === "erro" && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-red-700 dark:text-red-300">{job.erro}</p>
          <form action={tentarNovamente.bind(null, job.id)}>
            <button className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">Tentar novamente</button>
          </form>
        </div>
      )}

      {job.status === "aguardando_linhas" && job.largura && job.altura && (
        <EditorLinhas
          jobId={job.id}
          frameUrl={`${base}/frame0.jpg`}
          largura={job.largura}
          altura={job.altura}
          linhasIniciais={linhas}
          cameras={listarCameras().map((c) => ({ id: c.id, nome: c.nome, linhas: JSON.parse(c.linhas) as Linha[] }))}
          cameraInicial={job.camera_id}
          pontosUrl={temTrilhas(job.id) ? `${base}/pontos.json` : null}
        />
      )}

      {["sugerindo", "aguardando_revisao", "renderizando", "concluido"].includes(job.status) && (
        <>
          {!sugerindoAgora && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{job.mensagem}</p>
              {(job.status === "sugerindo" || job.status === "aguardando_revisao") && (
                <BotaoEditarLinhas jobId={job.id} rapido={temTrilhas(job.id)} />
              )}
            </div>
          )}
          {job.status === "sugerindo" && !sugerindoAgora && (
            <form action={retomarSugestoes.bind(null, job.id)} className="flex items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <span className="flex-1">Há candidatos sem sugestão do modelo de visão. A revisão começa quando todos tiverem sugestão.</span>
              <button className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700">Retomar sugestões</button>
            </form>
          )}
          <GradeCandidatos
            base={base}
            candidatos={listarCandidatos(job.id)}
            nomesLinhas={Object.fromEntries(linhas.map((l) => [l.id, l.nome]))}
          />
        </>
      )}
    </section>
  );
}
