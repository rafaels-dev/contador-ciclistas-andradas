import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listarCameras, listarCandidatos, obterGrupo, obterJob, resumoSugestoes, type Area, type Job, type Linha } from "@/lib/db";
import { previaDeteccao, SUFIXO_CHAVE, sugestoesAtivas, temTrilhas } from "@/lib/runner";
import { ETAPAS, etapaAtual, rotuloStatus } from "@/lib/status";
import { BOTAO, timecode } from "@/lib/ui";
import { cancelar, retomarSugestoes, revisarSemSugestoes, tentarNovamente } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { BotaoEditarLinhas } from "./botao-editar-linhas";
import { CategoriasDasLinhas } from "./categorias-linha";
import { EditorLinhas } from "./editor-linhas";
import { Revisao } from "./revisao";

export default function PaginaJob(props: PageProps<"/jobs/[id]">) {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando…</p>}>
      <DetalheJob params={props.params} />
    </Suspense>
  );
}

/** Importar → Linhas → Detecção → Sugestões → Revisão, com a etapa atual destacada. */
function Etapas({ job }: { job: Job }) {
  const atual = etapaAtual(job.status);
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="Etapas">
      {ETAPAS.map((nome, i) => {
        const estado = atual < 0 ? "futura" : i < atual ? "feita" : i === atual ? "atual" : "futura";
        return (
          <li key={nome} className="flex items-center gap-1" aria-current={estado === "atual" ? "step" : undefined}>
            {i > 0 && <span className={`h-px w-4 ${estado === "futura" ? "bg-line" : "bg-faint"}`} />}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                estado === "atual" ? "bg-accent font-semibold text-accent-ink" : estado === "feita" ? "text-muted" : "text-faint"
              }`}
            >
              <span className="font-mono">{estado === "feita" ? "✓" : i + 1}</span>
              {nome}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Sugestões paradas: alguns candidatos ficaram sem resposta da IA. Dá para
 * tentar de novo ou revisar assim mesmo (os sem sugestão são classificados
 * à mão). "Salvar diagnóstico" gera o arquivo para o suporte.
 */
function BarraSugestoesPendentes({ job }: { job: Job }) {
  const r = resumoSugestoes(job.id);
  const semResposta = r.total - r.ok;
  const soFalhas = r.ok + r.falhou >= r.total;
  const quantos = semResposta === 1 ? "1 objeto" : `${semResposta} objetos`;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn" data-testid="sugestoes-pendentes">
      <span className="flex-1">
        {soFalhas
          ? `A inteligência artificial não conseguiu sugerir ${quantos} de ${r.total}. Você pode tentar de novo ou revisar assim mesmo e classificar ${semResposta === 1 ? "esse" : "esses"} à mão.`
          : `${quantos} de ${r.total} ainda sem sugestão da inteligência artificial.`}
      </span>
      <form action={retomarSugestoes.bind(null, job.id)}>
        <button className={soFalhas ? BOTAO.secundario : BOTAO.primario}>Tentar de novo</button>
      </form>
      {soFalhas && (
        <form action={revisarSemSugestoes.bind(null, job.id)}>
          <button className={BOTAO.primario}>Revisar assim mesmo</button>
        </form>
      )}
      <a href="/api/diagnostico" className={BOTAO.fantasma} title="Salva um arquivo com o registro do app para enviar a quem dá suporte">
        Salvar diagnóstico
      </a>
    </div>
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
  const grupo = job.grupo_id ? obterGrupo(job.grupo_id) : undefined;
  const naRevisao = ["sugerindo", "aguardando_revisao", "renderizando", "concluido"].includes(job.status);
  const nome = job.nome_arquivo ?? job.drive_id;

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {trabalhando && <AutoRefresh />}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Caminho">
          <Link href={grupo ? `/?grupo=${grupo.id}` : "/"} className="shrink-0 text-muted hover:text-fg">
            {grupo?.nome ?? "Biblioteca"}
          </Link>
          <span className="text-faint">/</span>
          <h1 className="truncate font-semibold" title={nome}>
            {nome}
          </h1>
        </nav>
        <span className="font-mono text-[0.7rem] text-faint">
          {job.duracao_s ? timecode(job.duracao_s, true) : ""}
          {job.largura ? ` · ${job.largura}×${job.altura} · ${job.fps?.toFixed(0)} fps` : ""}
        </span>
        <span className="flex-1" />
        <Etapas job={job} />
        {(job.status === "sugerindo" || job.status === "aguardando_revisao") && !sugerindoAgora && <BotaoEditarLinhas jobId={job.id} rapido={temTrilhas(job.id)} />}
      </header>

      {trabalhando && (
        <div className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2.5" data-testid="progresso">
          <span className="shrink-0 text-sm font-medium">{rotuloStatus(job)}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(job.progresso * 100)}%` }} />
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
            {job.mensagem} {job.progresso > 0 && `· ${Math.round(job.progresso * 100)}%`}
          </span>
          {!sugerindoAgora && (
            <form action={cancelar.bind(null, job.id)}>
              <button className={BOTAO.perigo}>Cancelar</button>
            </form>
          )}
        </div>
      )}

      {job.status === "erro" && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p className="flex-1 text-danger">{job.erro}</p>
          {job.erro?.endsWith(SUFIXO_CHAVE) && (
            <Link href="/configuracoes" className={BOTAO.primario}>
              Abrir Configurações
            </Link>
          )}
          <form action={tentarNovamente.bind(null, job.id)}>
            <button className={BOTAO.secundario}>Tentar novamente</button>
          </form>
          <a href="/api/diagnostico" className={BOTAO.fantasma} title="Salva um arquivo com o registro do app para enviar a quem dá suporte">
            Salvar diagnóstico
          </a>
        </div>
      )}

      {(job.status === "baixando" || job.status === "detectando") && job.largura && (
        <PreviaDeteccao base={base} versao={job.status === "detectando" ? previaDeteccao(job.id) : null} />
      )}

      {job.status === "aguardando_linhas" && job.largura && job.altura && (
        <EditorLinhas
          jobId={job.id}
          frameUrl={`${base}/frame0.jpg`}
          largura={job.largura}
          altura={job.altura}
          linhasIniciais={linhas}
          areaInicial={job.area ? (JSON.parse(job.area) as Area) : null}
          cameras={listarCameras().map((c) => ({ id: c.id, nome: c.nome, linhas: JSON.parse(c.linhas) as Linha[], area: c.area ? (JSON.parse(c.area) as Area) : null }))}
          cameraInicial={job.camera_id}
          pontosUrl={temTrilhas(job.id) ? `${base}/pontos.json` : null}
        />
      )}

      {naRevisao && (
        <>
          {job.status === "sugerindo" && !sugerindoAgora && <BarraSugestoesPendentes job={job} />}
          <Revisao
            key={job.status}
            jobId={job.id}
            base={base}
            candidatos={listarCandidatos(job.id)}
            linhas={linhas}
            duracao={job.duracao_s ?? 0}
            fps={job.fps ?? 15}
            largura={job.largura ?? 1920}
            altura={job.altura ?? 1080}
            videoUrl={`/api/jobs/${job.id}/video`}
            area={job.area ? (JSON.parse(job.area) as Area) : null}
            editavel={job.status === "aguardando_revisao"}
            painelLinhas={(job.status === "sugerindo" || job.status === "aguardando_revisao") && <CategoriasDasLinhas jobId={job.id} linhas={linhas} />}
          />
        </>
      )}
    </div>
  );
}

/**
 * Durante a detecção, o quadro que o worker está analisando (com as caixas e
 * as linhas), trocado a cada atualização da página — um arquivo só, que o
 * worker sobrescreve. Antes do primeiro, o 1º quadro do vídeo, apagado.
 */
function PreviaDeteccao({ base, versao }: { base: string; versao: number | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-viewer p-6">
      {versao ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${base}/previa.jpg?v=${Math.round(versao)}`} alt="Quadro sendo analisado agora" className="min-h-0 max-w-full flex-1 object-contain" />
          <p className="text-xs text-muted">Quadro sendo analisado agora — as caixas são o que o detector está vendo.</p>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${base}/frame0.jpg`} alt="Primeiro quadro do vídeo" className="max-h-full max-w-full opacity-60" />
      )}
    </div>
  );
}
