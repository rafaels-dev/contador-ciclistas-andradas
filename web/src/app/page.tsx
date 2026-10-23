import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { jobTrabalhando } from "@/lib/atividade";
import { listarCandidatos, listarGrupos, listarJobs, obterGrupo, resumoRevisao } from "@/lib/db";
import { dirJob } from "@/lib/paths";
import { rotuloStatus } from "@/lib/status";
import { BOTAO } from "@/lib/ui";
import { CabecalhoGrupo } from "./cabecalho-grupo";
import { GradeVideos, type VideoNaGrade } from "./grade-videos";
import { AutoRefresh } from "./jobs/[id]/auto-refresh";

export default function Home(props: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando…</p>}>
      <Painel searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Painel({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const filtro = typeof sp.grupo === "string" ? sp.grupo : null;
  const grupo = filtro && filtro !== "sem" ? obterGrupo(filtro) : undefined;
  const grupos = listarGrupos();

  const jobs = listarJobs()
    .filter((j) => (filtro === "sem" ? !j.grupo_id : grupo ? j.grupo_id === grupo.id : true))
    .sort((a, b) => (a.nome_arquivo ?? a.drive_id).localeCompare(b.nome_arquivo ?? b.drive_id, "pt-BR", { numeric: true }));

  const videos: VideoNaGrade[] = jobs.map((j) => {
    const r = resumoRevisao(j.id);
    const naRevisao = j.status === "aguardando_revisao";
    return {
      id: j.id,
      nome: j.nome_arquivo ?? j.drive_id,
      local: j.drive_id === "local",
      grupo: grupos.find((g) => g.id === j.grupo_id)?.nome ?? null,
      status: j.status,
      rotulo: rotuloStatus(j),
      trabalhando: jobTrabalhando(j),
      progresso: j.progresso,
      mensagem: j.mensagem,
      erro: j.status === "erro" ? j.erro : null,
      duracao_s: j.duracao_s,
      miniatura: fs.existsSync(path.join(dirJob(j.id), "frame0.jpg")) ? `/api/jobs/${j.id}/arquivos/frame0.jpg` : null,
      revisados: r.revisados,
      total: r.total,
      contagens: naRevisao ? listarCandidatos(j.id).filter((c) => c.rotulo && c.rotulo !== "descartado").length : 0,
      // por que ainda não entra num vídeo final (null = pode)
      impedimento: !naRevisao ? (j.status === "sugerindo" ? "aguardando sugestões" : "revisão não começou") : r.revisados < r.total ? `faltam ${r.total - r.revisados} na revisão` : null,
    };
  });

  const titulo = grupo?.nome ?? (filtro === "sem" ? "Sem grupo" : "Todos os vídeos");

  return (
    <div className="flex flex-col gap-4 p-5">
      {videos.some((v) => v.trabalhando) && <AutoRefresh ms={2000} />}
      <CabecalhoGrupo grupo={grupo ?? null} titulo={titulo} videos={videos.length} />

      {videos.length === 0 ? (
        <Vazio grupo={!!filtro} />
      ) : (
        <GradeVideos key={filtro ?? ""} videos={videos} grupos={grupos.map((g) => ({ id: g.id, nome: g.nome }))} grupoAtual={grupo?.id ?? null} />
      )}
    </div>
  );
}

function Vazio({ grupo }: { grupo: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
      <p className="text-lg font-medium">{grupo ? "Nenhum vídeo neste grupo" : "A biblioteca está vazia"}</p>
      <p className="max-w-md text-sm text-muted">
        {grupo
          ? "Selecione vídeos em “Todos os vídeos” e use “Mover para grupo”, ou importe novos direto para cá."
          : "Importe um vídeo do Google Drive ou do computador. O app detecta o que se move, o modelo de visão sugere a classe de cada objeto e você confirma antes do vídeo final."}
      </p>
      <Link href="/importar" className={BOTAO.primario}>
        Importar vídeos
      </Link>
    </div>
  );
}
