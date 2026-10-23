import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CATEGORIAS, listarCandidatos, obterJob, obterRender, type Categoria, type Render } from "@/lib/db";
import { dirRender } from "@/lib/paths";
import { NOME_CATEGORIA } from "@/lib/revisao";
import { BOTAO, COR_CLASSE, TITULO_PAINEL, timecode } from "@/lib/ui";
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

const hms = (s: number) => timecode(Math.round(s), true);

function lerJson<T>(arquivo: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8")) as T;
  } catch {
    return null;
  }
}

export default function PaginaRender(props: PageProps<"/renders/[id]">) {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando…</p>}>
      <DetalheRender params={props.params} />
    </Suspense>
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
  const categoriasRender = render.categorias ? (JSON.parse(render.categorias) as Categoria[]) : null;
  const rel = render.status === "pronto" ? lerJson<Relatorio>(path.join(dir, "relatorio.json")) : null;
  const versao = encodeURIComponent(render.atualizado_em);

  // a revisão mudou depois do pedido? (o plano congela as decisões)
  const plano = lerJson<Plano>(path.join(dir, "plano.json"));
  const desatualizado =
    render.status === "pronto" &&
    plano?.videos.some((v) => {
      const atual = listarCandidatos(v.job)
        .filter((c) => c.rotulo && c.rotulo !== "descartado" && (!categoriasRender || categoriasRender.includes(c.rotulo)))
        .map((c) => `${c.id}:${c.rotulo}`)
        .sort()
        .join(",");
      return atual !== v.eventos.map((e) => `${e.id}:${e.categoria}`).sort().join(",");
    });

  const linhasTot = rel ? Object.keys(rel.totais) : [];
  const cats = CATEGORIAS.filter((c) => linhasTot.some((l) => rel?.totais[l]?.[c]));
  const duracaoTotal = rel ? rel.videos.reduce((s, v) => Math.max(s, v.inicio_no_final_s + v.duracao_s), 0) || 1 : 1;
  const pct = (s: number) => `${(s / duracaoTotal) * 100}%`;

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {trabalhando && <AutoRefresh ms={2000} />}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Caminho">
          <Link href="/renders" className="shrink-0 text-muted hover:text-fg">
            Exportações
          </Link>
          <span className="text-faint">/</span>
          <h1 className="truncate font-semibold" title={render.nome}>
            {render.nome}
          </h1>
        </nav>
        <span className="font-mono text-[0.7rem] text-faint">
          {ROTULO_STATUS[render.status]} · {jobs.length} {jobs.length === 1 ? "vídeo" : "vídeos"}
          {render.status === "pronto" && render.mensagem ? ` · ${render.mensagem}` : ""}
        </span>
        {categoriasRender && (
          <span className="text-xs text-muted" data-testid="categorias-render">
            Só {categoriasRender.map((c) => NOME_CATEGORIA[c]).join(", ")}
          </span>
        )}
      </header>

      {trabalhando && (
        <div className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2.5" data-testid="progresso">
          <span className="shrink-0 text-sm font-medium">{ROTULO_STATUS[render.status]}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(render.progresso * 100)}%` }} />
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
            {render.mensagem} {render.progresso > 0 && `· ${Math.round(render.progresso * 100)}%`}
          </span>
          <form action={cancelar.bind(null, render.id)}>
            <button className={BOTAO.perigo}>Cancelar</button>
          </form>
        </div>
      )}

      {render.status === "erro" && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p className="flex-1 text-danger">{render.erro}</p>
          <BotaoGerarDeNovo renderId={render.id} categorias={categoriasRender} rotulo="Tentar de novo" />
        </div>
      )}

      {desatualizado && (
        <div className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
          <span className="flex-1">A revisão de algum destes vídeos mudou depois que este vídeo final foi gerado.</span>
          <BotaoGerarDeNovo renderId={render.id} categorias={categoriasRender} rotulo="Gerar de novo com a revisão atual" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-w-0 flex-col bg-viewer lg:min-h-0" aria-label="Monitor">
          {render.status === "pronto" ? (
            <video data-final controls preload="metadata" className="min-h-0 w-full flex-1 bg-black" src={`${base}/video_final.mp4?v=${versao}`} />
          ) : (
            <div className="grid min-h-64 flex-1 place-items-center text-sm text-white/50">{trabalhando ? "Gerando o vídeo…" : "Sem vídeo"}</div>
          )}
        </section>

        <aside className="flex flex-col gap-4 border-line bg-panel px-4 py-3 lg:min-h-0 lg:overflow-y-auto lg:border-l">
          {render.status === "pronto" && (
            <section className="flex flex-col gap-2">
              <h2 className={TITULO_PAINEL}>Baixar</h2>
              <a className={BOTAO.primario} href={`${base}/video_final.mp4?download=contagem_${render.id}.mp4`}>
                Vídeo (MP4)
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a className={BOTAO.secundario} href={`${base}/eventos.csv?download=contagem_${render.id}.csv`}>
                  Planilha (CSV)
                </a>
                <a className={BOTAO.secundario} href={`${base}/relatorio.json?download=contagem_${render.id}.json`}>
                  Relatório (JSON)
                </a>
              </div>
              {!desatualizado && <BotaoGerarDeNovo renderId={render.id} categorias={categoriasRender} rotulo="Gerar de novo" />}
            </section>
          )}

          {rel && (
            <section className="flex flex-col gap-2" data-testid="totais-final">
              <h2 className={TITULO_PAINEL}>Contagem</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-faint">
                    <th className="py-1 text-left font-normal" />
                    {linhasTot.map((l) => (
                      <th key={l} className="max-w-20 truncate py-1 text-right font-normal" title={l}>
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c}>
                      <td className="py-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 rounded-sm ${COR_CLASSE[c].fundo}`} />
                          {NOME_CATEGORIA[c]}
                        </span>
                      </td>
                      {linhasTot.map((l) => {
                        const s = rel.por_sentido[l]?.[c] ?? {};
                        return (
                          <td key={l} className="py-0.5 text-right font-mono tabular-nums" title={Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(" · ") || undefined}>
                            {rel.totais[l]?.[c] ?? 0}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className={TITULO_PAINEL}>Vídeos, na ordem</h2>
            <ol className="flex flex-col gap-1 text-sm">
              {jobs.map((j, i) => {
                const v = rel?.videos[i];
                const n = v ? Object.values(v.totais).reduce((a, t) => a + Object.values(t).reduce((x, y) => x + (y ?? 0), 0), 0) : null;
                return (
                  <li key={j} className="flex items-center gap-2">
                    <span className="w-4 text-right font-mono text-xs text-faint">{i + 1}</span>
                    <Link href={`/jobs/${j}`} className="min-w-0 flex-1 truncate hover:underline">
                      {obterJob(j)?.nome_arquivo ?? j}
                    </Link>
                    {v && (
                      <>
                        <PularPara s={v.inicio_no_final_s + 2}>{hms(v.inicio_no_final_s)}</PularPara>
                        <span className="font-mono text-xs text-faint">{n}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>

      {rel && (
        <section className="shrink-0 border-t border-line bg-panel" aria-label="Sequência do vídeo final" data-testid="timeline">
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)]">
            <div className="flex h-8 items-center border-b border-r border-line px-3 text-xs font-medium text-muted">Vídeos</div>
            <div className="relative h-8 border-b border-line">
              {rel.videos.map((v, i) => (
                <span
                  key={i}
                  className={`absolute bottom-1 top-1 flex items-center overflow-hidden rounded-sm border-r border-black/40 px-1.5 text-[0.7rem] font-medium text-white ${i % 2 ? "bg-info/70" : "bg-info/50"}`}
                  style={{ left: pct(v.inicio_no_final_s), width: pct(v.duracao_s) }}
                  title={v.titulo}
                >
                  <span className="truncate">{v.titulo}</span>
                </span>
              ))}
            </div>
            <div className="flex h-8 items-center border-b border-r border-line px-3 text-xs font-medium text-muted">Contagens</div>
            <div className="relative h-8 border-b border-line bg-raised/50">
              {rel.eventos.map((e) => (
                <PularPara key={`${e.video}-${e.candidato}`} s={e.tempo_no_final_s} marca={COR_CLASSE[e.categoria]?.fundo} left={pct(e.tempo_no_final_s)} titulo={`${NOME_CATEGORIA[e.categoria]} · ${e.linha} ${e.sentido} · ${hms(e.tempo_no_final_s)}`} />
              ))}
            </div>
          </div>
        </section>
      )}

      {rel && rel.eventos.length > 0 && (
        <details className="shrink-0 border-t border-line bg-panel px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Lista de contagens ({rel.eventos.length}) — clique no horário para ver no vídeo</summary>
          <div className="max-h-72 overflow-y-auto">
            <table className="mt-2 w-full">
              <thead className="text-left text-xs text-faint">
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
                  <tr key={`${e.video}-${e.candidato}`} className="border-t border-line/60">
                    <td className="py-1 pr-3"><PularPara s={e.tempo_no_final_s}>{hms(e.tempo_no_final_s)}</PularPara></td>
                    <td className="py-1 pr-3">{e.video} <span className="font-mono text-xs text-faint">({hms(e.tempo_no_video_s)})</span></td>
                    <td className="py-1 pr-3">{e.linha}</td>
                    <td className="py-1 pr-3">{NOME_CATEGORIA[e.categoria]}</td>
                    <td className="py-1">{e.sentido}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
