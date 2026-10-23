"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Candidato, Categoria, Linha } from "@/lib/db";
import { calcularTotais, NOME_CATEGORIA, possiveisDuplicados, proposta, type Classe } from "@/lib/revisao";
import { BOTAO, CAMPO, COR_CLASSE, TITULO_PAINEL, timecode } from "@/lib/ui";
import { gerarVideoFinal } from "../../renders/actions";
import { EscolhaCategorias } from "../../renders/escolha-categorias";
import { CATEGORIAS_CONTADAS } from "@/lib/revisao";
import { revisar } from "./actions";

// teclas 1–8 e 0, na ordem dos botões
const ATALHOS: [Classe, string][] = [
  ["ciclistas", "1"],
  ["pedestres", "2"],
  ["automoveis", "3"],
  ["motocicletas", "4"],
  ["patinetes", "5"],
  ["scooters", "6"],
  ["monociclos", "7"],
  ["outros", "8"],
  ["descartado", "0"],
];
const POR_TECLA: Record<string, Classe> = { ...Object.fromEntries(ATALHOS.map(([c, k]) => [k, c])), x: "descartado" };

type Filtro = "pendentes" | "revisados" | "todos" | "divergentes" | "fora" | "duplicados" | Classe;

const PRINCIPAIS: Filtro[] = ["pendentes", "revisados", "todos"];
const OUTROS_FILTROS: Filtro[] = ["duplicados", "fora", "divergentes", "ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "automoveis", "motocicletas", "outros", "descartado"];
const NOME_FILTRO: Partial<Record<Filtro, string>> = {
  pendentes: "Pendentes",
  revisados: "Revisados",
  todos: "Todos",
  divergentes: "Modelo ≠ detector",
  fora: "Fora da linha",
  duplicados: "Possível duplicado",
};
const nomeFiltro = (f: Filtro) => NOME_FILTRO[f] ?? NOME_CATEGORIA[f as Classe];

type Props = {
  jobId: string;
  base: string;
  candidatos: Candidato[];
  linhas: Linha[];
  duracao: number;
  /** false enquanto há sugestões em curso: só leitura */
  editavel: boolean;
  /** painel "o que cada linha conta", mostrado no inspetor */
  painelLinhas?: React.ReactNode;
};

/**
 * Revisão humana no formato de um editor: lista de candidatos (o "bin"),
 * monitor com o clipe do candidato em foco, inspetor com a decisão e uma
 * timeline do vídeo inteiro com uma trilha por linha de contagem.
 */
export function Revisao({ jobId, base, candidatos, linhas, duracao, editavel, painelLinhas }: Props) {
  const porId = useMemo(() => Object.fromEntries(linhas.map((l) => [l.id, l])), [linhas]);
  const [rotulos, setRotulos] = useState<Record<number, Classe | null>>(() =>
    Object.fromEntries(candidatos.map((c) => [c.id, c.rotulo])),
  );
  const [filtro, setFiltro] = useState<Filtro>(editavel ? "pendentes" : "todos");
  const [linhaFiltro, setLinhaFiltro] = useState("");
  const [foco, setFoco] = useState<number | null>(null);
  const [limiar, setLimiar] = useState(0.9);
  const [ultimas, setUltimas] = useState<{ id: number; antes: Classe | null }[][]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciar] = useTransition();
  const [gerando, iniciarRender] = useTransition();
  const [categoriasFinal, setCategoriasFinal] = useState<Categoria[]>([...CATEGORIAS_CONTADAS]);
  const [escolhendoFinal, setEscolhendoFinal] = useState(false);

  const porIdCand = useMemo(() => Object.fromEntries(candidatos.map((c) => [c.id, c])), [candidatos]);
  // número fixo de cada candidato no vídeo (ordem do tempo), igual em qualquer filtro
  const numero = useMemo(
    () => Object.fromEntries([...candidatos].sort((a, b) => a.tempo_s - b.tempo_s || a.id - b.id).map((c, i) => [c.id, i + 1])),
    [candidatos],
  );
  const props = useMemo(() => Object.fromEntries(candidatos.map((c) => [c.id, proposta(c, porId)])), [candidatos, porId]);
  const rotulo = (c: Candidato) => rotulos[c.id] ?? null;
  const divergente = (c: Candidato) => c.status_llm === "ok" && c.sugestao_llm !== c.classe_yolo;
  const classeDe = (c: Candidato) => rotulo(c) ?? props[c.id].classe;
  const duplicados = possiveisDuplicados(candidatos, (id) => classeDe(porIdCand[id]));
  const passa = (c: Candidato, f: Filtro) => {
    switch (f) {
      case "todos": return true;
      case "pendentes": return !rotulo(c);
      case "revisados": return !!rotulo(c);
      case "divergentes": return divergente(c);
      case "fora": return !!props[c.id].foraDaLinha;
      case "duplicados": return duplicados.has(c.id);
      default: return classeDe(c) === f;
    }
  };
  const naLinha = candidatos.filter((c) => !linhaFiltro || c.linha_id === linhaFiltro);
  const visiveis = naLinha.filter((c) => passa(c, filtro));
  const visivel = new Set(visiveis.map((c) => c.id));
  const totais = calcularTotais(candidatos.map((c) => ({ ...c, rotulo: rotulo(c) })));
  const confiaveis = visiveis.filter((c) => !rotulo(c) && props[c.id].classe && (c.conf_llm ?? 0) >= limiar);

  function decidir(decisoes: { id: number; rotulo: Classe | null }[], desfazendo = false) {
    if (!editavel || !decisoes.length) return;
    const antes = decisoes.map((d) => ({ id: d.id, antes: rotulos[d.id] ?? null }));
    setRotulos((r) => ({ ...r, ...Object.fromEntries(decisoes.map((d) => [d.id, d.rotulo])) }));
    if (!desfazendo) setUltimas((u) => [...u.slice(-49), antes]);
    setErro(null);
    iniciar(async () => {
      const r = await revisar(jobId, decisoes);
      if (r.erro) {
        setErro(r.erro);
        setRotulos((x) => ({ ...x, ...Object.fromEntries(antes.map((a) => [a.id, a.antes])) }));
      }
    });
  }

  /** decide o candidato em foco e pula para o próximo pendente da lista */
  function decidirFoco(c: Candidato, classe: Classe | null) {
    if (!classe) return;
    decidir([{ id: c.id, rotulo: classe }]);
    const i = visiveis.findIndex((x) => x.id === c.id);
    const prox = [...visiveis.slice(i + 1), ...visiveis.slice(0, i)].find((x) => !rotulo(x));
    setFoco(prox?.id ?? c.id);
  }

  function desfazer() {
    const ultima = ultimas.at(-1);
    if (!ultima) return;
    setUltimas((u) => u.slice(0, -1));
    decidir(ultima.map((a) => ({ id: a.id, rotulo: a.antes })), true);
    if (ultima.length === 1) setFoco(ultima[0].id);
  }

  /** leva a um candidato mesmo que o filtro atual o esconda */
  function irPara(id: number, filtroSeOculto: Filtro = "todos") {
    if (!visivel.has(id)) {
      setFiltro(filtroSeOculto);
      setLinhaFiltro("");
    }
    setFoco(id);
  }

  // o foco precisa estar na lista visível (troca de filtro, item decidido sumiu)
  const focado = visiveis.find((c) => c.id === foco) ?? visiveis[0] ?? null;

  useEffect(() => {
    if (focado) document.getElementById(`cand-${focado.id}`)?.scrollIntoView({ block: "nearest" });
  }, [focado?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(alvo.tagName)) return;
      const k = e.key.toLowerCase();
      const i = focado ? visiveis.findIndex((c) => c.id === focado.id) : -1;
      if (k === "arrowdown" || k === "j") setFoco(visiveis[Math.min(visiveis.length - 1, i + 1)]?.id ?? null);
      else if (k === "arrowup" || k === "k") setFoco(visiveis[Math.max(0, i - 1)]?.id ?? null);
      else if (k === "u" || k === "backspace") desfazer();
      else if (!focado) return;
      else if (k === "enter" || k === " ") decidirFoco(focado, props[focado.id].classe);
      else if (POR_TECLA[k]) decidirFoco(focado, POR_TECLA[k]);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const contar = (f: Filtro) => naLinha.filter((c) => passa(c, f)).length;

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {/* barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-sm">
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Filtro">
          {PRINCIPAIS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              aria-pressed={filtro === f}
              className={`px-2.5 py-1 ${filtro === f ? "bg-accent font-semibold text-accent-ink" : "bg-raised text-muted hover:bg-hover hover:text-fg"}`}
            >
              {nomeFiltro(f)} <span className="font-mono text-xs opacity-70">{contar(f)}</span>
            </button>
          ))}
        </div>
        <select
          value={PRINCIPAIS.includes(filtro) ? "" : filtro}
          onChange={(e) => setFiltro((e.target.value || "pendentes") as Filtro)}
          className={`${CAMPO} py-1 ${PRINCIPAIS.includes(filtro) ? "" : "border-accent"}`}
          aria-label="Mais filtros"
        >
          <option value="">Mais filtros…</option>
          {OUTROS_FILTROS.map((f) => (
            <option key={f} value={f}>
              {nomeFiltro(f)} ({contar(f)})
            </option>
          ))}
        </select>
        {linhas.length > 1 && (
          <select value={linhaFiltro} onChange={(e) => setLinhaFiltro(e.target.value)} className={`${CAMPO} py-1`} aria-label="Filtrar por linha">
            <option value="">Todas as linhas</option>
            {linhas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        )}

        {editavel && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => decidir(confiaveis.map((c) => ({ id: c.id, rotulo: props[c.id].classe })))}
              disabled={!confiaveis.length}
              className={BOTAO.secundario}
              title="Aceita a proposta dos pendentes do filtro atual com confiança mínima"
            >
              Aceitar {confiaveis.length} com confiança ≥
            </button>
            <select value={limiar} onChange={(e) => setLimiar(Number(e.target.value))} className={`${CAMPO} py-1`} aria-label="Confiança mínima">
              {[0.8, 0.9, 0.95].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
            <button type="button" onClick={desfazer} disabled={!ultimas.length} className={BOTAO.fantasma} title="Desfazer (U)">
              ↶ Desfazer
            </button>
          </>
        )}

        <span className="flex-1" />
        {duplicados.size > 0 && (
          <button type="button" onClick={() => setFiltro("duplicados")} className="rounded-md px-2 py-1 text-warn hover:bg-warn/10">
            ⚠ {duplicados.size} possíveis duplicados
          </button>
        )}
        {erro && <span className="text-danger">{erro}</span>}
        {editavel && (
          <>
            <span className="font-mono text-xs text-muted">{totais.pendentes ? `faltam ${totais.pendentes}` : "revisão completa"}</span>
            <span className="relative">
              <button
                type="button"
                disabled={totais.pendentes > 0 || gerando}
                onClick={() => setEscolhendoFinal((v) => !v)}
                aria-expanded={escolhendoFinal}
                className={BOTAO.primario}
                title={totais.pendentes ? "Revise todos os candidatos para liberar" : "Gera o vídeo com o contador"}
              >
                Gerar vídeo final…
              </button>
              {escolhendoFinal && (
                <div className="absolute right-0 top-full z-20 mt-1 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-line bg-panel p-3 shadow-xl" data-testid="menu-video-final">
                  <EscolhaCategorias valor={categoriasFinal} aoMudar={setCategoriasFinal} />
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setEscolhendoFinal(false)} className={BOTAO.fantasma}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!categoriasFinal.length || gerando}
                      onClick={() =>
                        iniciarRender(async () => {
                          const r = await gerarVideoFinal([jobId], categoriasFinal);
                          if (r.erro) setErro(r.erro);
                          else setEscolhendoFinal(false);
                        })
                      }
                      className={BOTAO.primario}
                    >
                      {gerando ? "Enviando…" : "Gerar vídeo final"}
                    </button>
                  </div>
                </div>
              )}
            </span>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[19rem_minmax(0,1fr)_19rem]">
        <ListaCandidatos
          visiveis={visiveis}
          base={base}
          focado={focado?.id ?? null}
          numero={numero}
          classeDe={classeDe}
          rotulo={rotulo}
          conf={(c) => (c.status_llm === "ok" ? c.conf_llm : null)}
          porLinha={porId}
          duplicados={duplicados}
          aoFocar={setFoco}
          vazio={filtro === "pendentes" ? "Nada pendente neste filtro." : "Nenhum candidato neste filtro."}
        />

        <Monitor c={focado} base={base} numero={focado ? numero[focado.id] : 0} linha={focado?.linha_id ? porId[focado.linha_id] : undefined} />

        <aside className="flex flex-col border-line bg-panel lg:min-h-0 lg:overflow-y-auto lg:border-l">
          {focado ? (
            <Inspetor
              c={focado}
              linha={focado.linha_id ? porId[focado.linha_id] : undefined}
              prop={props[focado.id]}
              rotulo={rotulo(focado)}
              editavel={editavel}
              numero={numero[focado.id]}
              duplicadoDe={(duplicados.get(focado.id) ?? []).map((id) => ({ c: porIdCand[id], numero: numero[id] }))}
              aoDecidir={(classe) => decidirFoco(focado, classe)}
              aoDesfazer={() => decidir([{ id: focado.id, rotulo: null }])}
              aoIrPara={(id) => irPara(id, "duplicados")}
            />
          ) : (
            <p className="p-4 text-sm text-muted">Nenhum candidato em foco.</p>
          )}
          <QuadroTotais totais={totais} linhas={linhas} total={candidatos.length} />
          {painelLinhas}
          {editavel && (
            <details className="border-t border-line px-4 py-3 text-xs text-muted">
              <summary className={`${TITULO_PAINEL} cursor-pointer`}>Atalhos de teclado</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>anterior / próximo</dd>
                <dt><kbd>Enter</kbd></dt><dd>aceita a proposta</dd>
                {ATALHOS.map(([c, k]) => (
                  <span key={k} className="contents">
                    <dt><kbd>{k}</kbd></dt>
                    <dd>{c === "descartado" ? "descartar" : NOME_CATEGORIA[c]}</dd>
                  </span>
                ))}
                <dt><kbd>U</kbd></dt><dd>desfaz</dd>
              </dl>
            </details>
          )}
        </aside>
      </div>

      <Timeline
        candidatos={candidatos}
        linhas={linhas}
        duracao={duracao}
        focado={focado?.id ?? null}
        visivel={visivel}
        classeDe={classeDe}
        decidido={(c) => !!rotulo(c)}
        numero={numero}
        aoFocar={(id) => irPara(id)}
      />
    </div>
  );
}

function Amostra({ classe, vazado = false }: { classe: Classe | null; vazado?: boolean }) {
  if (!classe) return <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-faint" />;
  const cor = COR_CLASSE[classe];
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${vazado ? `border-2 ${cor.borda}` : cor.fundo}`} />;
}

type PropsLista = {
  visiveis: Candidato[];
  base: string;
  focado: number | null;
  numero: Record<number, number>;
  classeDe: (c: Candidato) => Classe | null;
  rotulo: (c: Candidato) => Classe | null;
  conf: (c: Candidato) => number | null;
  porLinha: Record<string, Linha>;
  duplicados: Map<number, number[]>;
  aoFocar: (id: number) => void;
  vazio: string;
};

function ListaCandidatos({ visiveis, base, focado, numero, classeDe, rotulo, conf, porLinha, duplicados, aoFocar, vazio }: PropsLista) {
  return (
    <ul className="flex max-h-[60vh] flex-col overflow-y-auto border-line bg-panel lg:max-h-none lg:min-h-0 lg:border-r" aria-label="Candidatos">
      {visiveis.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">{vazio}</li>}
      {visiveis.map((c) => {
        const r = rotulo(c);
        const classe = classeDe(c);
        const ativo = focado === c.id;
        const p = conf(c);
        const linha = c.linha_id ? porLinha[c.linha_id] : undefined;
        return (
          <li
            key={c.id}
            id={`cand-${c.id}`}
            data-testid="candidato"
            data-rotulo={r ?? ""}
            onClick={() => aoFocar(c.id)}
            className={`flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-2.5 py-1.5 ${
              ativo ? "bg-accent/15 shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-hover"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${base}/${c.filmstrip}`} alt="" loading="lazy" className={`h-10 w-24 shrink-0 rounded-sm bg-viewer object-cover ${r && !ativo ? "opacity-60" : ""}`} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm">
                <span
                  className={`rounded px-1 font-mono text-[0.7rem] font-semibold tabular-nums ${duplicados.has(c.id) ? "bg-warn text-white" : "bg-raised text-muted"}`}
                  data-testid="numero"
                >
                  #{numero[c.id]}
                </span>
                <Amostra classe={classe} vazado={!r} />
                <span className={`truncate ${r ? "text-muted" : "font-medium"}`}>
                  {classe ? (classe === "descartado" ? "Descartar" : NOME_CATEGORIA[classe]) : c.status_llm === "falhou" ? "Sugestão falhou" : "Aguardando…"}
                </span>
                {!r && p !== null && <span className="font-mono text-[0.7rem] text-faint">{Math.round(p * 100)}%</span>}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[0.7rem] text-faint">
                <span>{timecode(c.tempo_s)}</span>
                {linha && (
                  <span className="truncate">
                    {linha.nome} {c.direcao}
                  </span>
                )}
              </span>
            </span>
            {r && (
              <span className={`shrink-0 text-xs ${r === "descartado" ? "text-faint" : "text-ok"}`} title="Revisado">
                ✓
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** O clipe do candidato em foco, grande, como o monitor de programa de um editor. */
function Monitor({ c, base, numero, linha }: { c: Candidato | null; base: string; numero: number; linha: Linha | undefined }) {
  const [aba, setAba] = useState<"clipe" | "quadro">("clipe");
  const temClipe = !!c?.clipe;
  const mostrar = aba === "quadro" && c?.contexto ? "quadro" : temClipe ? "clipe" : "quadro";
  return (
    <section className="flex min-w-0 flex-col bg-viewer lg:min-h-0" aria-label="Monitor">
      <div className="relative flex min-h-64 flex-1 items-center justify-center overflow-hidden">
        {!c ? (
          <span className="text-sm text-white/50">Escolha um candidato</span>
        ) : mostrar === "clipe" ? (
          <video key={c.id} src={`${base}/${c.clipe}`} autoPlay loop muted playsInline className="max-h-full max-w-full" />
        ) : c.contexto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${base}/${c.contexto}`} alt={`Quadro do cruzamento do candidato ${numero}`} className="max-h-full max-w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${base}/${c.filmstrip}`} alt={`Candidato ${numero}`} className="max-h-full max-w-full object-contain" />
        )}
        {c && (
          <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 font-mono text-xs text-white">
            #{numero} · {timecode(c.tempo_s, true)}
            {linha && ` · ${linha.nome} ${c.direcao ?? ""}`}
          </span>
        )}
        {c && (c.clipe || c.contexto) && (
          <div className="absolute right-3 top-3 flex overflow-hidden rounded border border-white/15 text-xs" role="group" aria-label="Mostrar">
            {(
              [
                ["clipe", "Clipe", !!c.clipe],
                ["quadro", "Cruzamento", !!c.contexto],
              ] as const
            ).map(([k, nome, ok]) => (
              <button
                key={k}
                type="button"
                disabled={!ok}
                onClick={() => setAba(k)}
                aria-pressed={mostrar === k}
                className={`px-2 py-0.5 ${mostrar === k ? "bg-accent font-semibold text-accent-ink" : "bg-black/60 text-white/80 hover:bg-black/80"} disabled:opacity-30`}
              >
                {nome}
              </button>
            ))}
          </div>
        )}
      </div>
      {c?.filmstrip && (
        <div className="border-t border-white/10 bg-black/40 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${base}/${c.filmstrip}`} alt="Recortes do objeto ao longo do tempo" className="mx-auto h-20 max-w-full object-contain" />
        </div>
      )}
    </section>
  );
}

type PropsInspetor = {
  c: Candidato;
  linha: Linha | undefined;
  prop: ReturnType<typeof proposta>;
  rotulo: Classe | null;
  editavel: boolean;
  numero: number;
  /** candidatos que podem ser o mesmo objeto (mesma linha, sentido e classe, quase juntos) */
  duplicadoDe: { c: Candidato; numero: number }[];
  aoDecidir: (c: Classe) => void;
  aoDesfazer: () => void;
  aoIrPara: (id: number) => void;
};

function Inspetor({ c, linha, prop, rotulo, editavel, numero, duplicadoDe, aoDecidir, aoDesfazer, aoIrPara }: PropsInspetor) {
  const corrigido = rotulo && rotulo !== prop.classe;
  const conf = c.conf_llm ?? 0;
  return (
    <div className="flex flex-col gap-4 px-4 py-3" data-testid="inspetor">
      <div className="flex flex-col gap-2">
        <h2 className={TITULO_PAINEL}>Sugestão do modelo</h2>
        {c.status_llm === "ok" && prop.classe ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold">
              <Amostra classe={prop.foraDaLinha ?? prop.classe} />
              {prop.foraDaLinha ? NOME_CATEGORIA[prop.foraDaLinha] : NOME_CATEGORIA[prop.classe]}
              <span className="ml-auto font-mono text-sm font-normal text-muted">{Math.round(conf * 100)}%</span>
            </p>
            <span className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className={`block h-full ${conf >= 0.9 ? "bg-ok" : conf >= 0.7 ? "bg-accent" : "bg-warn"}`} style={{ width: `${conf * 100}%` }} />
            </span>
            {prop.foraDaLinha && (
              <p className="text-xs text-warn">
                {NOME_CATEGORIA[prop.foraDaLinha]} não conta em {linha?.nome ?? "esta linha"} — proposta: descartar.
              </p>
            )}
          </>
        ) : c.status_llm === "falhou" ? (
          <p className="font-medium text-danger">A sugestão falhou</p>
        ) : (
          <p className="text-muted">Aguardando sugestão…</p>
        )}
        {c.justificativa_llm && <p className="text-sm text-muted">{c.justificativa_llm}</p>}
        <p className="text-xs text-faint">
          Detector: {c.classe_yolo ? NOME_CATEGORIA[c.classe_yolo] : "?"}
          {c.alternativa && ` ou ${NOME_CATEGORIA[c.alternativa]}`}
          {c.origem && c.origem !== "track" && ` · ${c.origem.replaceAll("_", " ")}`}
        </p>
      </div>

      {duplicadoDe.length > 0 && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" data-testid="duplicado">
          ⚠ Pode ser o mesmo objeto que{" "}
          {duplicadoDe.map((d, i) => (
            <span key={d.c.id}>
              {i > 0 && ", "}
              <button type="button" onClick={() => aoIrPara(d.c.id)} className="font-semibold underline">
                o #{d.numero}
              </button>{" "}
              ({timecode(d.c.tempo_s)})
            </span>
          ))}{" "}
          — confira se não está contando duas vezes.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className={TITULO_PAINEL}>Decisão · #{numero}</h2>
        {rotulo ? (
          <p className="flex items-center gap-2 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold text-white ${corrigido ? "bg-info" : "bg-ok"}`}>{corrigido ? "Corrigido" : "Confirmado"}</span>
            <Amostra classe={rotulo} />
            {NOME_CATEGORIA[rotulo]}
            {editavel && (
              <button type="button" onClick={aoDesfazer} className={`${BOTAO.fantasma} ml-auto text-xs`}>
                desfazer
              </button>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted">Pendente</p>
        )}
        {editavel && (
          <>
            {prop.classe && (
              <button type="button" onClick={() => aoDecidir(prop.classe!)} className={`${BOTAO.primario} justify-between py-2`}>
                <span>Aceitar: {prop.classe === "descartado" ? "descartar" : NOME_CATEGORIA[prop.classe]}</span>
                <kbd className="border-accent-ink/30 bg-transparent text-accent-ink">Enter</kbd>
              </button>
            )}
            <div className="grid grid-cols-2 gap-1">
              {ATALHOS.map(([classe, k]) => (
                <button
                  key={classe}
                  type="button"
                  onClick={() => aoDecidir(classe)}
                  aria-pressed={rotulo === classe}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs ${
                    rotulo === classe ? "border-fg bg-fg text-app" : "border-line bg-raised hover:bg-hover"
                  } ${classe === "descartado" ? "col-span-2" : ""}`}
                >
                  <Amostra classe={classe} />
                  <span className="flex-1 truncate">{classe === "descartado" ? "Descartar (não é objeto)" : NOME_CATEGORIA[classe as Categoria]}</span>
                  <span className="font-mono opacity-50">{k}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ORDEM: Categoria[] = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "motocicletas", "automoveis", "outros"];

/** Totais confirmados (só decisões humanas): categoria × linha, com os sentidos no hover. */
function QuadroTotais({ totais, linhas, total }: { totais: ReturnType<typeof calcularTotais>; linhas: Linha[]; total: number }) {
  const ids = linhas.length ? linhas.map((l) => l.id) : [""];
  const nome = (id: string) => linhas.find((l) => l.id === id)?.nome ?? "Total";
  return (
    <section className="flex flex-col gap-2 border-t border-line px-4 py-3" data-testid="totais">
      <h2 className={TITULO_PAINEL}>Contagem confirmada</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-faint">
            <th className="py-1 text-left font-normal" />
            {ids.map((id) => (
              <th key={id} className="max-w-20 truncate py-1 text-right font-normal" title={nome(id)}>
                {nome(id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ORDEM.map((cat) => {
            const valores = ids.map((id) => Object.values(totais.porLinha[id]?.[cat] ?? {}).reduce((a, b) => a + b, 0));
            const algum = valores.some((n) => n > 0);
            return (
              <tr key={cat} className={algum ? "" : "text-faint"}>
                <td className="py-0.5">
                  <span className="flex items-center gap-1.5">
                    <Amostra classe={cat} />
                    {NOME_CATEGORIA[cat]}
                  </span>
                </td>
                {ids.map((id, i) => {
                  const linha = linhas.find((l) => l.id === id);
                  const conta = !linha?.categorias?.length || linha.categorias.includes(cat);
                  const s = totais.porLinha[id]?.[cat] ?? {};
                  return (
                    <td
                      key={id}
                      className={`py-0.5 text-right font-mono tabular-nums ${conta ? "" : "opacity-40"}`}
                      title={Object.keys(s).length ? Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(" · ") : undefined}
                    >
                      {valores[i]}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="font-mono text-[0.7rem] text-faint">
        {total - totais.pendentes}/{total} revisados · {totais.contados} contados · {totais.descartados} descartados
      </p>
    </section>
  );
}

/** Passo das marcas da régua: no máximo ~10 marcas no vídeo todo. */
function passoRegua(duracao: number): number {
  const passos = [10, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return passos.find((p) => duracao / p <= 10) ?? 3600;
}

type PropsTimeline = {
  candidatos: Candidato[];
  linhas: Linha[];
  duracao: number;
  focado: number | null;
  visivel: Set<number>;
  classeDe: (c: Candidato) => Classe | null;
  decidido: (c: Candidato) => boolean;
  numero: Record<number, number>;
  aoFocar: (id: number) => void;
};

/**
 * O vídeo inteiro de ponta a ponta, uma trilha por linha de contagem; cada
 * candidato é uma marca na cor da classe (vazada enquanto pendente). O
 * playhead amarelo é o candidato em foco.
 */
function Timeline({ candidatos, linhas, duracao, focado, visivel, classeDe, decidido, numero, aoFocar }: PropsTimeline) {
  const fim = Math.max(duracao, ...candidatos.map((c) => c.tempo_s), 1);
  const trilhas = linhas.length ? linhas.map((l) => ({ id: l.id as string | null, nome: l.nome })) : [{ id: null, nome: "Candidatos" }];
  const passo = passoRegua(fim);
  const marcas = Array.from({ length: Math.floor(fim / passo) + 1 }, (_, i) => i * passo).filter((s) => fim - s > passo / 3);
  const cFocado = candidatos.find((c) => c.id === focado);
  const pct = (s: number) => `${(s / fim) * 100}%`;

  return (
    <section className="shrink-0 overflow-hidden border-t border-line bg-panel" aria-label="Linha do tempo" data-testid="timeline">
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)]">
        <div className="flex h-6 items-center border-b border-r border-line px-3 font-mono text-[0.7rem] text-faint">{timecode(fim, true)}</div>
        <div className="relative h-6 overflow-hidden border-b border-line">
          {marcas.map((s) => (
            <span key={s} className="absolute top-0 flex h-full items-end border-l border-line pb-0.5 pl-1 font-mono text-[0.65rem] text-faint" style={{ left: pct(s) }}>
              {timecode(s, fim >= 3600)}
            </span>
          ))}
          {cFocado && <span className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-accent" style={{ left: pct(cFocado.tempo_s) }} aria-hidden />}
        </div>
        {trilhas.map((t) => (
          <div key={t.id ?? "-"} className="contents">
            <div className="flex h-9 items-center truncate border-b border-r border-line px-3 text-xs font-medium text-muted" title={t.nome}>
              {t.nome}
            </div>
            <div className="relative h-9 overflow-hidden border-b border-line bg-raised/50">
              {cFocado && <span className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-accent" style={{ left: pct(cFocado.tempo_s) }} aria-hidden />}
              {candidatos
                .filter((c) => (t.id === null ? true : c.linha_id === t.id))
                .map((c) => {
                  const classe = classeDe(c);
                  const cor = classe ? COR_CLASSE[classe] : null;
                  const ok = decidido(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => aoFocar(c.id)}
                      title={`#${numero[c.id]} · ${classe ? NOME_CATEGORIA[classe] : "sem sugestão"} · ${timecode(c.tempo_s)}`}
                      aria-label={`Ir para o candidato ${numero[c.id]}`}
                      className={`absolute bottom-1.5 top-1.5 w-1 -translate-x-1/2 rounded-[1px] ${
                        ok ? (cor?.fundo ?? "bg-faint") : `border ${cor?.borda ?? "border-faint"} bg-transparent`
                      } ${visivel.has(c.id) ? "" : "opacity-25"} hover:bottom-0.5 hover:top-0.5`}
                      style={{ left: pct(c.tempo_s) }}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
