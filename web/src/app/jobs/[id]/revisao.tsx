"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Candidato, Categoria, Linha } from "@/lib/db";
import { calcularTotais, NOME_CATEGORIA, possiveisDuplicados, proposta, type Classe } from "@/lib/revisao";
import Link from "next/link";
import { gerarVideoFinal } from "../../renders/actions";
import { revisar } from "./actions";

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

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

type Props = {
  jobId: string;
  base: string;
  candidatos: Candidato[];
  linhas: Linha[];
  /** false enquanto há sugestões em curso ou depois do render: só leitura */
  editavel: boolean;
};

export function Revisao({ jobId, base, candidatos, linhas, editavel }: Props) {
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

  const porIdCand = useMemo(() => Object.fromEntries(candidatos.map((c) => [c.id, c])), [candidatos]);
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

  // o foco precisa estar na lista visível (troca de filtro, item decidido sumiu)
  const focado = visiveis.find((c) => c.id === foco) ?? visiveis[0] ?? null;

  useEffect(() => {
    if (focado) document.getElementById(`cand-${focado.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

  const filtros: Filtro[] = ["pendentes", "revisados", "todos", "ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "automoveis", "motocicletas", "outros", "descartado", "fora", "divergentes", "duplicados"];
  const nomeFiltro = (f: Filtro) =>
    ({ pendentes: "Pendentes", revisados: "Revisados", todos: "Todos", divergentes: "Modelo ≠ detector", fora: "Fora da linha", duplicados: "Possível duplicado" } as Record<string, string>)[f] ??
    NOME_CATEGORIA[f as Classe];

  return (
    <div className="flex flex-col gap-4">
      <QuadroTotais totais={totais} linhas={linhas} total={candidatos.length} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {filtros.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1 ${filtro === f ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
          >
            {nomeFiltro(f)} ({naLinha.filter((c) => passa(c, f)).length})
          </button>
        ))}
        {linhas.length > 1 && (
          <select
            value={linhaFiltro}
            onChange={(e) => setLinhaFiltro(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Filtrar por linha"
          >
            <option value="">Todas as linhas</option>
            {linhas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      {editavel && (
        <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => decidir(confiaveis.map((c) => ({ id: c.id, rotulo: props[c.id].classe })))}
              disabled={!confiaveis.length}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Aceitar {confiaveis.length} proposta(s) com confiança ≥
            </button>
            <select
              value={limiar}
              onChange={(e) => setLimiar(Number(e.target.value))}
              className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Confiança mínima"
            >
              {[0.8, 0.9, 0.95].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
            <span className="text-zinc-500">entre os pendentes do filtro atual</span>
            <button onClick={desfazer} disabled={!ultimas.length} className="ml-auto rounded px-2 py-1 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-800">
              Desfazer (U)
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Teclado: <kbd>↑</kbd>/<kbd>↓</kbd> navega · <kbd>Enter</kbd> aceita a proposta · <kbd>1</kbd> ciclista ·{" "}
            <kbd>2</kbd> pedestre · <kbd>3</kbd> automóvel · <kbd>4</kbd> moto · <kbd>5</kbd> patinete · <kbd>6</kbd> scooter elétrico · <kbd>7</kbd> monociclo ·{" "}
            <kbd>8</kbd> outros · <kbd>0</kbd> descartar · <kbd>U</kbd> desfaz
          </p>
          {erro && <p className="text-red-600">{erro}</p>}
        </div>
      )}

      {visiveis.length === 0 && (
        <p className="py-8 text-center text-zinc-500">{filtro === "pendentes" ? "Nada pendente neste filtro. 🎉" : "Nenhum candidato neste filtro."}</p>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visiveis.map((c) => (
          <Cartao
            key={c.id}
            c={c}
            base={base}
            linha={c.linha_id ? porId[c.linha_id] : undefined}
            prop={props[c.id]}
            rotulo={rotulo(c)}
            focado={focado?.id === c.id}
            editavel={editavel}
            aoFocar={() => setFoco(c.id)}
            aoDecidir={(classe) => decidirFoco(c, classe)}
            aoDesfazer={() => decidir([{ id: c.id, rotulo: null }])}
            duplicadoDe={(duplicados.get(c.id) ?? []).map((id) => porIdCand[id])}
            aoIrPara={(id) => {
              if (!visiveis.some((v) => v.id === id)) setFiltro("duplicados");
              setFoco(id);
            }}
          />
        ))}
      </ul>

      {editavel && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-zinc-200 bg-white/95 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950/95">
          <span>
            {totais.pendentes
              ? `Faltam ${totais.pendentes} de ${candidatos.length} para liberar o vídeo final.`
              : "Revisão completa."}{" "}
            {duplicados.size > 0 && (
              <button onClick={() => setFiltro("duplicados")} className="text-amber-700 hover:underline dark:text-amber-300">
                ⚠ {duplicados.size} possíveis duplicados — conferir.
              </button>
            )}{" "}
            <Link href="/" className="text-emerald-700 hover:underline dark:text-emerald-400">
              Juntar com outros vídeos
            </Link>
          </span>
          <button
            disabled={totais.pendentes > 0 || gerando}
            onClick={() =>
              iniciarRender(async () => {
                const r = await gerarVideoFinal([jobId]);
                if (r.erro) setErro(r.erro);
              })
            }
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            Gerar vídeo final
          </button>
        </div>
      )}
    </div>
  );
}

type PropsCartao = {
  c: Candidato;
  base: string;
  linha: Linha | undefined;
  prop: ReturnType<typeof proposta>;
  rotulo: Classe | null;
  focado: boolean;
  editavel: boolean;
  aoFocar: () => void;
  aoDecidir: (c: Classe) => void;
  aoDesfazer: () => void;
  /** candidatos que podem ser o mesmo objeto (mesma linha, sentido e classe, quase juntos) */
  duplicadoDe: Candidato[];
  aoIrPara: (id: number) => void;
};

function Cartao({ c, base, linha, prop, rotulo, focado, editavel, aoFocar, aoDecidir, aoDesfazer, duplicadoDe, aoIrPara }: PropsCartao) {
  const corrigido = rotulo && rotulo !== prop.classe;
  return (
    <li
      id={`cand-${c.id}`}
      onClick={aoFocar}
      data-testid="candidato"
      data-rotulo={rotulo ?? ""}
      className={`scroll-mb-24 scroll-mt-4 overflow-hidden rounded-lg border ${
        focado ? "border-emerald-500 ring-2 ring-emerald-500" : "border-zinc-200 dark:border-zinc-800"
      } ${rotulo && !focado ? "opacity-70" : ""}`}
    >
      <div className="bg-black">
        {focado && c.clipe ? (
          <video src={`${base}/${c.clipe}`} autoPlay loop muted playsInline className="mx-auto max-h-64" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${base}/${c.filmstrip}`} alt={`Candidato ${c.id}`} loading="lazy" className="mx-auto h-28 object-contain" />
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {c.status_llm === "ok" && prop.classe ? (
            <span className="font-medium">
              {prop.foraDaLinha ? (
                <>
                  Descartar{" "}
                  <span className="font-normal text-amber-700 dark:text-amber-300">
                    ({NOME_CATEGORIA[prop.foraDaLinha]} não conta em {linha?.nome ?? "esta linha"})
                  </span>
                </>
              ) : (
                NOME_CATEGORIA[prop.classe]
              )}{" "}
              <span className="font-normal text-zinc-500">{Math.round((c.conf_llm ?? 0) * 100)}%</span>
            </span>
          ) : c.status_llm === "falhou" ? (
            <span className="font-medium text-red-600">Sugestão falhou</span>
          ) : (
            <span className="text-zinc-500">Aguardando sugestão…</span>
          )}
          <span className="text-zinc-500">{mmss(c.tempo_s)}</span>
          {linha && (
            <span className="text-zinc-500">
              {linha.nome} {c.direcao}
            </span>
          )}
        </div>
        {c.justificativa_llm && <p className="text-xs text-zinc-600 dark:text-zinc-400">{c.justificativa_llm}</p>}
        {duplicadoDe.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="duplicado">
            ⚠ Pode ser o mesmo objeto que{" "}
            {duplicadoDe.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <button onClick={(e) => (e.stopPropagation(), aoIrPara(d.id))} className="font-medium underline">
                  o de {mmss(d.tempo_s)}
                </button>
              </span>
            ))}{" "}
            — confira se não está contando duas vezes.
          </p>
        )}
        <div className="text-xs text-zinc-500">
          Detector: {c.classe_yolo ? NOME_CATEGORIA[c.classe_yolo] : "?"}
          {c.alternativa && ` ou ${NOME_CATEGORIA[c.alternativa]}`}
          {c.origem && c.origem !== "track" && ` · ${c.origem.replaceAll("_", " ")}`}
        </div>

        {rotulo && (
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                corrigido ? "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
              }`}
            >
              {corrigido ? "Corrigido" : "Confirmado"}: {NOME_CATEGORIA[rotulo]}
            </span>
            {editavel && (
              <button onClick={(e) => (e.stopPropagation(), aoDesfazer())} className="text-xs text-zinc-500 hover:underline">
                desfazer
              </button>
            )}
          </div>
        )}

        {editavel && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {prop.classe && (
              <button
                onClick={(e) => (e.stopPropagation(), aoDecidir(prop.classe!))}
                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                title="Enter"
              >
                ✓ Aceitar
              </button>
            )}
            {ATALHOS.map(([classe, k]) => (
              <button
                key={classe}
                onClick={(e) => (e.stopPropagation(), aoDecidir(classe))}
                className={`rounded px-2 py-1 text-xs ${
                  rotulo === classe ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                }`}
              >
                {classe === "descartado" ? "Descartar" : NOME_CATEGORIA[classe as Categoria]} <span className="opacity-50">{k}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

const ORDEM: Categoria[] = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "motocicletas", "automoveis", "outros"];

function QuadroTotais({ totais, linhas, total }: { totais: ReturnType<typeof calcularTotais>; linhas: Linha[]; total: number }) {
  const ids = linhas.length ? linhas.map((l) => l.id) : [""];
  const nome = (id: string) => linhas.find((l) => l.id === id)?.nome ?? "Sem linha";
  const sentidos = linhas.length ? ["A→B", "B→A"] : ["—"];
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800" data-testid="totais">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2 font-medium">Confirmados</th>
            {ORDEM.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-medium">
                {NOME_CATEGORIA[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const linha = linhas.find((l) => l.id === id);
            return (
              <tr key={id} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-3 py-2">{nome(id)}</td>
                {ORDEM.map((cat) => {
                  const porSentido = totais.porLinha[id]?.[cat] ?? {};
                  const n = Object.values(porSentido).reduce((a, b) => a + b, 0);
                  const conta = !linha?.categorias?.length || linha.categorias.includes(cat);
                  return (
                    <td key={cat} className={`px-3 py-2 text-right tabular-nums ${conta ? "" : "text-zinc-400"}`}>
                      <span className="font-medium">{n}</span>
                      {sentidos.length > 1 && n > 0 && (
                        <span className="ml-1 text-xs text-zinc-500">({sentidos.map((s) => `${s} ${porSentido[s] ?? 0}`).join(" · ")})</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        {total - totais.pendentes} de {total} revisados · {totais.contados} contados · {totais.descartados} descartados ·{" "}
        {totais.pendentes} pendentes
      </p>
    </div>
  );
}
