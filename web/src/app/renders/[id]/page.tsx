import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CATEGORIAS, listarCandidatos, obterJob, obterRender, type Categoria, type Render } from "@/lib/db";
import { dirRender } from "@/lib/paths";
import { NOME_CATEGORIA } from "@/lib/revisao";
import { AutoRefresh } from "../../jobs/[id]/auto-refresh";
import { cancelar } from "../actions";
import { BotaoGerarDeNovo, PularPara } from "./controles";

type Relatorio = {
  gerado_em: string;
  totais: Record<string, Partial<Record<Categoria, number>>>;
  por_sentido: Record<string, Partial<Record<Categoria, Record<string, number>>>>;
  videos: { titulo: string; inicio_no_final_s: number; duracao_s: number; totais: Record<string, Partial<Record<Categoria, number>>> }[];
  eventos: { video: string; candidato: number; linha: string; categoria: Categoria; sentido: string; tempo_no_video_s: number; tempo_no_final_s: number }[];
};

type Plano = { videos: { job: string; eventos: { id: number; categoria: string }[] }[] };

const ROTULO_STATUS: Record<Render["status"], string> = {
  na_fila: "Na fila",
  renderizando: "Gerando vídeo final",
  pronto: "Pronto",
  erro: "Erro",
};

function hms(s: number) {
  const t = Math.round(s);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function lerJson<T>(arquivo: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8")) as T;
  } catch {
    return null;
  }
}

export default function PaginaRender(props: PageProps<"/renders/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Início
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Carregando…</p>}>
        <DetalheRender params={props.params} />
      </Suspense>
    </main>
  );
}

async function DetalheRender({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = obterRender(id);
  if (!render) notFound();
  const dir = dirRender(id);
  const base = `/api/renders/${id}/arquivos`;
  const trabalhando = render.status === "na_fila" || render.status === "renderizando";
  const jobs = JSON.parse(render.jobs) as string[];
  const rel = render.status === "pronto" ? lerJson<Relatorio>(path.join(dir, "relatorio.json")) : null;
  const versao = encodeURIComponent(render.atualizado_em);

  // a revisão mudou depois do pedido? (o plano congela as decisões)
  const plano = lerJson<Plano>(path.join(dir, "plano.json"));
  const desatualizado =
    render.status === "pronto" &&
    plano?.videos.some((v) => {
      const atual = listarCandidatos(v.job)
        .filter((c) => c.rotulo && c.rotulo !== "descartado")
        .map((c) => `${c.id}:${c.rotulo}`)
        .sort()
        .join(",");
      return atual !== v.eventos.map((e) => `${e.id}:${e.categoria}`).sort().join(",");
    });

  const linhasTot = rel ? Object.keys(rel.totais) : [];
  const cats = CATEGORIAS.filter((c) => linhasTot.some((l) => rel?.totais[l]?.[c]));

  return (
    <section className="flex flex-col gap-6">
      {trabalhando && <AutoRefresh ms={2000} />}
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold break-all">Vídeo final · {render.nome}</h1>
        <p className="text-sm text-zinc-500">
          {ROTULO_STATUS[render.status]} · {jobs.length} {jobs.length === 1 ? "vídeo" : "vídeos"}
          {render.status === "pronto" && render.mensagem ? ` · ${render.mensagem}` : ""}
        </p>
      </header>

      {trabalhando && (
        <div className="flex flex-col gap-2" data-testid="progresso">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${Math.round(render.progresso * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {render.mensagem} {render.progresso > 0 && `${Math.round(render.progresso * 100)}%`}
            </p>
            <form action={cancelar.bind(null, render.id)}>
              <button className="rounded-lg px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {render.status === "erro" && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-red-700 dark:text-red-300">{render.erro}</p>
          <BotaoGerarDeNovo renderId={render.id} rotulo="Tentar de novo" />
        </div>
      )}

      {desatualizado && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>A revisão de algum destes vídeos mudou depois que este vídeo final foi gerado.</span>
          <BotaoGerarDeNovo renderId={render.id} rotulo="Gerar de novo com a revisão atual" />
        </div>
      )}

      {render.status === "pronto" && (
        <>
          <video data-final controls preload="metadata" className="w-full rounded-lg bg-black" src={`${base}/video_final.mp4?v=${versao}`} />
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700" href={`${base}/video_final.mp4?download=contagem_${render.id}.mp4`}>
              Baixar vídeo (MP4)
            </a>
            <a className="rounded-lg bg-zinc-100 px-3 py-1.5 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700" href={`${base}/eventos.csv?download=contagem_${render.id}.csv`}>
              Planilha de eventos (CSV)
            </a>
            <a className="rounded-lg bg-zinc-100 px-3 py-1.5 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700" href={`${base}/relatorio.json?download=contagem_${render.id}.json`}>
              Relatório (JSON)
            </a>
            {!desatualizado && <BotaoGerarDeNovo renderId={render.id} rotulo="Gerar de novo" />}
          </div>
        </>
      )}

      {rel && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800" data-testid="totais-final">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Total</th>
                {cats.map((c) => (
                  <th key={c} className="px-3 py-2 text-right font-medium">{NOME_CATEGORIA[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhasTot.map((l) => (
                <tr key={l} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2">{l}</td>
                  {cats.map((c) => {
                    const n = rel.totais[l]?.[c] ?? 0;
                    const s = rel.por_sentido[l]?.[c] ?? {};
                    return (
                      <td key={c} className="px-3 py-2 text-right tabular-nums">
                        <span className="font-medium">{n}</span>
                        {n > 0 && Object.keys(s).length > 1 && (
                          <span className="ml-1 text-xs text-zinc-500">({Object.entries(s).map(([k, v]) => `${k} ${v}`).join(" · ")})</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Vídeos, na ordem</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {jobs.map((j, i) => {
            const v = rel?.videos[i];
            const n = v ? Object.values(v.totais).reduce((a, t) => a + Object.values(t).reduce((x, y) => x + (y ?? 0), 0), 0) : null;
            return (
              <li key={j} className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-500">{i + 1}.</span>
                <Link href={`/jobs/${j}`} className="hover:underline">{obterJob(j)?.nome_arquivo ?? j}</Link>
                {v && (
                  <>
                    <span className="text-zinc-500">· começa em</span>
                    <PularPara s={v.inicio_no_final_s + 2}>{hms(v.inicio_no_final_s)}</PularPara>
                    <span className="text-zinc-500">· {n} contagens</span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {rel && rel.eventos.length > 0 && (
        <details className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">Contagens ({rel.eventos.length}) — clique no horário para ver no vídeo</summary>
          <table className="mt-2 w-full">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-normal">No vídeo final</th>
                <th className="py-1 pr-3 font-normal">Vídeo</th>
                <th className="py-1 pr-3 font-normal">Linha</th>
                <th className="py-1 pr-3 font-normal">Categoria</th>
                <th className="py-1 font-normal">Sentido</th>
              </tr>
            </thead>
            <tbody>
              {rel.eventos.map((e) => (
                <tr key={`${e.video}-${e.candidato}`} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 pr-3"><PularPara s={e.tempo_no_final_s}>{hms(e.tempo_no_final_s)}</PularPara></td>
                  <td className="py-1 pr-3">{e.video} <span className="text-zinc-500">({hms(e.tempo_no_video_s)})</span></td>
                  <td className="py-1 pr-3">{e.linha}</td>
                  <td className="py-1 pr-3">{NOME_CATEGORIA[e.categoria]}</td>
                  <td className="py-1">{e.sentido}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
