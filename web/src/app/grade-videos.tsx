"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StatusJob } from "@/lib/db";
import { BOTAO, CAMPO, timecode } from "@/lib/ui";
import { moverParaGrupo } from "./_shell/actions";
import { gerarVideoFinal } from "./renders/actions";
import { EscolhaCategorias } from "./renders/escolha-categorias";
import { CATEGORIAS_CONTADAS } from "@/lib/revisao";
import type { Categoria } from "@/lib/db";

export type VideoNaGrade = {
  id: string;
  nome: string;
  local: boolean;
  grupo: string | null;
  status: StatusJob;
  rotulo: string;
  trabalhando: boolean;
  progresso: number;
  mensagem: string | null;
  erro: string | null;
  duracao_s: number | null;
  miniatura: string | null;
  revisados: number;
  total: number;
  contagens: number;
  impedimento: string | null;
};

type Props = { videos: VideoNaGrade[]; grupos: { id: string; nome: string }[]; grupoAtual: string | null };

const ordenarPorNome = (a: VideoNaGrade, b: VideoNaGrade) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true });

/**
 * Os vídeos de um grupo como clipes num painel de mídia. Marcar vídeos abre
 * a barra de ações: mover de grupo ou montar um vídeo final com eles (na
 * ordem escolhida — o contador soma entre os vídeos).
 */
export function GradeVideos({ videos, grupos, grupoAtual }: Props) {
  const [marcados, setMarcados] = useState<string[]>([]);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [exportando, setExportando] = useState<string[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const porId = Object.fromEntries(videos.map((v) => [v.id, v]));
  const existentes = marcados.filter((id) => porId[id]);
  const prontos = videos.filter((v) => !v.impedimento);

  function alternar(id: string, intervalo: boolean) {
    setMarcados((m) => {
      if (intervalo && ultimo) {
        // Shift+clique marca do último até este, como num gerenciador de arquivos
        const ids = videos.map((v) => v.id);
        const [a, b] = [ids.indexOf(ultimo), ids.indexOf(id)].sort((x, y) => x - y);
        return [...new Set([...m, ...ids.slice(a, b + 1)])];
      }
      return m.includes(id) ? m.filter((x) => x !== id) : [...m, id];
    });
    setUltimo(id);
  }

  function abrirExportacao() {
    setErro(null);
    setExportando(existentes.map((id) => porId[id]).filter((v) => !v.impedimento).sort(ordenarPorNome).map((v) => v.id));
  }

  const naoProntos = existentes.filter((id) => porId[id].impedimento);

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-5 flex min-h-11 flex-wrap items-center gap-2 border-b border-line bg-app/95 px-5 py-1.5 text-sm backdrop-blur">
        {existentes.length ? (
          <>
            <span className="font-medium">
              {existentes.length} {existentes.length === 1 ? "selecionado" : "selecionados"}
            </span>
            <button type="button" onClick={() => setMarcados([])} className={BOTAO.fantasma}>
              Limpar
            </button>
            <span className="mx-1 h-5 w-px bg-line" />
            <label className="flex items-center gap-2 text-muted">
              Mover para
              <select
                className={CAMPO}
                value=""
                disabled={pendente}
                onChange={(e) => {
                  const destino = e.target.value === "-" ? null : e.target.value;
                  iniciar(async () => {
                    await moverParaGrupo(existentes, destino);
                    setMarcados([]);
                  });
                }}
              >
                <option value="" disabled>
                  escolha o grupo…
                </option>
                {grupos.filter((g) => g.id !== grupoAtual).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
                <option value="-">Sem grupo</option>
              </select>
            </label>
            <span className="flex-1" />
            {naoProntos.length > 0 && (
              <span className="text-xs text-muted">
                {naoProntos.length} ainda sem revisão completa {naoProntos.length === 1 ? "fica" : "ficam"} de fora
              </span>
            )}
            <button type="button" onClick={abrirExportacao} disabled={existentes.length === naoProntos.length} className={BOTAO.primario}>
              Montar vídeo final…
            </button>
          </>
        ) : (
          <>
            <span className="text-muted">Marque vídeos para mover de grupo ou juntar num vídeo final.</span>
            <span className="flex-1" />
            {prontos.length > 0 && (
              <button type="button" onClick={() => setMarcados(prontos.map((v) => v.id))} className={BOTAO.fantasma}>
                {prontos.length === 1 ? "Marcar o revisado" : `Marcar os ${prontos.length} revisados`}
              </button>
            )}
            <button type="button" onClick={() => setMarcados(videos.map((v) => v.id))} className={BOTAO.fantasma}>
              Marcar todos
            </button>
          </>
        )}
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4" data-testid="grade-videos">
        {videos.map((v) => (
          <Clipe key={v.id} v={v} marcado={existentes.includes(v.id)} aoMarcar={(intervalo) => alternar(v.id, intervalo)} mostrarGrupo={!grupoAtual} />
        ))}
      </ul>

      {exportando && (
        <BandejaExportacao
          ordem={exportando}
          porId={porId}
          setOrdem={setExportando}
          erro={erro}
          pendente={pendente}
          aoFechar={() => setExportando(null)}
          aoGerar={(categorias) => iniciar(async () => setErro((await gerarVideoFinal(exportando, categorias)).erro ?? null))}
        />
      )}
    </div>
  );
}

function Selo({ v }: { v: VideoNaGrade }) {
  const completo = v.status === "aguardando_revisao" && !v.impedimento;
  const [texto, cor] =
    v.status === "erro"
      ? ["Erro", "bg-danger text-white"]
      : v.status === "aguardando_linhas"
        ? ["Desenhar linhas", "bg-accent text-accent-ink"]
        : completo
          ? ["Revisado", "bg-ok text-white"]
          : v.status === "aguardando_revisao"
            ? ["Revisar", "bg-info text-white"]
            : v.status === "sugerindo" && !v.trabalhando
              ? ["Sugestões paradas", "bg-warn text-white"]
              : [v.rotulo, "bg-black/70 text-white"];
  return <span className={`rounded px-1.5 py-0.5 text-[0.7rem] font-semibold ${cor}`}>{texto}</span>;
}

function Clipe({ v, marcado, aoMarcar, mostrarGrupo }: { v: VideoNaGrade; marcado: boolean; aoMarcar: (intervalo: boolean) => void; mostrarGrupo: boolean }) {
  return (
    <li
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-panel ${marcado ? "border-accent ring-1 ring-accent" : "border-line hover:border-faint"}`}
      data-testid="video"
    >
      <Link href={`/jobs/${v.id}`} className="flex flex-col">
        <span className="relative block aspect-video bg-viewer">
          {v.miniatura ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.miniatura} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-xs text-faint">{v.status === "baixando" ? (v.local ? "Abrindo…" : "Baixando…") : "Sem prévia"}</span>
          )}
          <span className="absolute right-1.5 top-1.5">
            <Selo v={v} />
          </span>
          {v.duracao_s ? (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 font-mono text-[0.7rem] text-white">{timecode(v.duracao_s, true)}</span>
          ) : null}
          {v.trabalhando && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50" data-testid="progresso">
              <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(v.progresso * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="flex flex-col gap-1 px-2.5 py-2">
          <span className="truncate text-sm font-medium" title={v.nome}>
            {v.nome}
          </span>
          <span className="flex min-h-4 items-center gap-2 text-xs text-muted">
            {v.trabalhando ? (
              <span className="truncate font-mono tabular-nums">
                {v.mensagem} {v.progresso > 0 && `· ${Math.round(v.progresso * 100)}%`}
              </span>
            ) : v.erro ? (
              <span className="truncate text-danger" title={v.erro}>
                {v.erro}
              </span>
            ) : v.total > 0 ? (
              <>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                  <span className={`block h-full ${v.revisados === v.total ? "bg-ok" : "bg-info"}`} style={{ width: `${(v.revisados / v.total) * 100}%` }} />
                </span>
                <span className="font-mono tabular-nums">
                  {v.revisados}/{v.total}
                </span>
              </>
            ) : (
              <span>{v.rotulo}</span>
            )}
          </span>
          {(mostrarGrupo && v.grupo) || v.contagens > 0 ? (
            <span className="flex gap-2 text-[0.7rem] text-faint">
              {mostrarGrupo && v.grupo && <span className="truncate">{v.grupo}</span>}
              {v.contagens > 0 && <span className="ml-auto shrink-0">{v.contagens} contagens</span>}
            </span>
          ) : null}
        </span>
      </Link>
      <label
        className={`absolute left-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-items-center rounded bg-black/60 ${marcado ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
        onClick={(e) => {
          e.preventDefault();
          aoMarcar(e.shiftKey);
        }}
      >
        <input type="checkbox" checked={marcado} readOnly aria-label={`Marcar ${v.nome}`} className="h-4 w-4 accent-[var(--accent)]" />
      </label>
    </li>
  );
}

type PropsBandeja = {
  ordem: string[];
  porId: Record<string, VideoNaGrade>;
  setOrdem: (o: string[]) => void;
  erro: string | null;
  pendente: boolean;
  aoFechar: () => void;
  aoGerar: (categorias: Categoria[]) => void;
};

/** A sequência do vídeo final, como uma trilha: cada vídeo é um bloco proporcional à duração. */
function BandejaExportacao({ ordem, porId, setOrdem, erro, pendente, aoFechar, aoGerar }: PropsBandeja) {
  const total = ordem.reduce((s, id) => s + (porId[id]?.duracao_s ?? 0), 0) || 1;
  const [categorias, setCategorias] = useState<Categoria[]>([...CATEGORIAS_CONTADAS]);
  const mover = (i: number, d: number) => {
    const n = [...ordem];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setOrdem(n);
  };
  return (
    <section className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-3 border-t border-line bg-panel px-5 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]" aria-label="Montar vídeo final" data-testid="bandeja-exportacao">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-semibold">Vídeo final</h2>
        <span className="text-sm text-muted">
          {ordem.length} {ordem.length === 1 ? "vídeo" : "vídeos"} · {timecode(total, true)} · o contador soma entre eles (linhas com o mesmo nome contam juntas)
        </span>
        <span className="flex-1" />
        <button type="button" onClick={aoFechar} className={BOTAO.fantasma}>
          Fechar
        </button>
      </div>
      <div className="flex h-9 overflow-hidden rounded-md border border-line bg-viewer" aria-hidden>
        {ordem.map((id, i) => (
          <span
            key={id}
            className={`flex min-w-0 items-center border-r border-black/40 px-2 text-[0.7rem] font-medium text-white ${i % 2 ? "bg-info/70" : "bg-info/50"}`}
            style={{ width: `${((porId[id]?.duracao_s ?? 0) / total) * 100}%` }}
            title={porId[id]?.nome}
          >
            <span className="truncate">{porId[id]?.nome}</span>
          </span>
        ))}
      </div>
      <ol className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-sm">
        {ordem.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded px-1 hover:bg-hover">
            <span className="w-6 text-right font-mono text-xs text-faint">{i + 1}</span>
            <span className="flex-1 truncate">{porId[id]?.nome}</span>
            <span className="font-mono text-xs text-faint">{porId[id]?.contagens} contagens</span>
            <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} className={BOTAO.fantasma} aria-label={`Subir ${porId[id]?.nome}`}>
              ↑
            </button>
            <button type="button" disabled={i === ordem.length - 1} onClick={() => mover(i, 1)} className={BOTAO.fantasma} aria-label={`Descer ${porId[id]?.nome}`}>
              ↓
            </button>
            <button type="button" onClick={() => setOrdem(ordem.filter((x) => x !== id))} className={BOTAO.fantasma} aria-label={`Tirar ${porId[id]?.nome}`}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <EscolhaCategorias valor={categorias} aoMudar={setCategorias} />
      <div className="flex items-center gap-3">
        <button type="button" disabled={!ordem.length || !categorias.length || pendente} onClick={() => aoGerar(categorias)} className={BOTAO.primario}>
          {pendente ? "Enviando…" : `Gerar vídeo final${ordem.length > 1 ? ` com ${ordem.length} vídeos` : ""}`}
        </button>
        {erro && <span className="text-sm text-danger">{erro}</span>}
      </div>
    </section>
  );
}
