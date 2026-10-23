"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Linha } from "@/lib/db";
import { confirmarLinhas } from "./actions";
import { BOTAO, CAMPO, TITULO_PAINEL } from "@/lib/ui";
import { ChipsCategorias } from "./categorias-linha";

type Props = {
  jobId: string;
  frameUrl: string;
  largura: number;
  altura: number;
  linhasIniciais: Linha[];
  cameras: { id: string; nome: string; linhas: Linha[] }[];
  cameraInicial: string | null;
  /** pontos de chão das trajetórias já detectadas (null antes da 1ª detecção) */
  pontosUrl: string | null;
};

type Pontos = Partial<Record<"ciclistas" | "pedestres" | "automoveis" | "motocicletas" | "outros", [number, number][]>>;

const COR_PONTOS: Record<keyof Pontos, { cor: string; nome: string }> = {
  ciclistas: { cor: "#22c55e", nome: "Ciclistas" },
  pedestres: { cor: "#3b82f6", nome: "Pedestres" },
  motocicletas: { cor: "#d946ef", nome: "Motos" },
  automoveis: { cor: "#f97316", nome: "Automóveis" },
  outros: { cor: "#a8a29e", nome: "Outros (movimento)" },
};

const CORES = ["#facc15", "#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#c084fc"];

/** Lado A fica à direita de quem anda de (x1,y1) para (x2,y2) — mesma convenção do worker. */
function rotulosLados(l: Linha, W: number, H: number) {
  const ax = l.x1 * W, ay = l.y1 * H, bx = l.x2 * W, by = l.y2 * H;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.max(W, H) * 0.03;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return {
    mx, my,
    a: { x: mx + (dy / len) * off, y: my - (dx / len) * off },
    b: { x: mx - (dy / len) * off, y: my + (dx / len) * off },
  };
}

export function EditorLinhas({ jobId, frameUrl, largura: W, altura: H, linhasIniciais, cameras, cameraInicial, pontosUrl }: Props) {
  const [pontos, setPontos] = useState<Pontos | null>(null);
  const [visiveis, setVisiveis] = useState<Set<string>>(new Set(Object.keys(COR_PONTOS)));
  useEffect(() => {
    if (!pontosUrl) return;
    fetch(pontosUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPontos)
      .catch(() => setPontos(null));
  }, [pontosUrl]);
  const [linhas, setLinhas] = useState<Linha[]>(linhasIniciais);
  const [rascunho, setRascunho] = useState<Linha | null>(null);
  const [cameraId, setCameraId] = useState(cameraInicial ?? "");
  const [nomeCamera, setNomeCamera] = useState(cameras.find((c) => c.id === cameraInicial)?.nome ?? "");
  const [salvarComoCamera, setSalvarComoCamera] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);

  function ponto(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function aoPressionar(e: React.PointerEvent) {
    const p = ponto(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const n = linhas.length + 1;
    let id = `l${n}`;
    while (linhas.some((l) => l.id === id)) id += "b";
    setRascunho({ id, nome: `Linha ${n}`, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }

  function aoMover(e: React.PointerEvent) {
    if (!rascunho) return;
    const p = ponto(e);
    setRascunho({ ...rascunho, x2: p.x, y2: p.y });
  }

  function aoSoltar() {
    if (rascunho && Math.hypot((rascunho.x2 - rascunho.x1) * W, (rascunho.y2 - rascunho.y1) * H) > 20) {
      setLinhas([...linhas, rascunho]);
    }
    setRascunho(null);
  }

  function carregarCamera(id: string) {
    setCameraId(id);
    const cam = cameras.find((c) => c.id === id);
    if (cam) {
      setLinhas(cam.linhas);
      setNomeCamera(cam.nome);
    }
  }

  function enviar() {
    setErro(null);
    iniciar(async () => {
      const camera = salvarComoCamera && nomeCamera.trim() ? { id: cameraId, nome: nomeCamera } : null;
      const r = await confirmarLinhas(jobId, linhas, camera);
      if (r.erro) setErro(r.erro);
    });
  }

  const todas = rascunho ? [...linhas, rascunho] : linhas;

  return (
    <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-w-0 items-center justify-center bg-viewer p-4 lg:min-h-0" aria-label="Quadro do vídeo">
        <div className="relative max-h-full w-full select-none overflow-hidden" style={{ aspectRatio: `${W} / ${H}`, maxWidth: `calc((100dvh - 9rem) * ${W / H})` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frameUrl} alt="Primeiro quadro do vídeo" className="absolute inset-0 h-full w-full" draggable={false} />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
            onPointerDown={aoPressionar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            data-testid="area-desenho"
          >
            {pontos &&
              (Object.keys(COR_PONTOS) as (keyof Pontos)[])
                .filter((k) => visiveis.has(k))
                .map((k) => (
                  <g key={k} fill={COR_PONTOS[k].cor} fillOpacity={0.55} pointerEvents="none">
                    {pontos[k]?.map(([x, y], i) => <circle key={i} cx={x * W} cy={y * H} r={Math.max(W, H) * 0.0018} />)}
                  </g>
                ))}
            {todas.map((l, i) => {
              const cor = CORES[i % CORES.length];
              const r = rotulosLados(l, W, H);
              const fonte = Math.max(W, H) * 0.018;
              return (
                <g key={l.id} pointerEvents="none">
                  <line x1={l.x1 * W} y1={l.y1 * H} x2={l.x2 * W} y2={l.y2 * H} stroke="black" strokeWidth={fonte * 0.45} strokeOpacity={0.5} />
                  <line x1={l.x1 * W} y1={l.y1 * H} x2={l.x2 * W} y2={l.y2 * H} stroke={cor} strokeWidth={fonte * 0.25} />
                  <circle cx={l.x1 * W} cy={l.y1 * H} r={fonte * 0.35} fill={cor} />
                  <circle cx={l.x2 * W} cy={l.y2 * H} r={fonte * 0.35} fill={cor} />
                  {l !== rascunho && (
                    <>
                      <text x={r.a.x} y={r.a.y} fill={cor} fontSize={fonte} fontWeight="bold" textAnchor="middle" dominantBaseline="middle" stroke="black" strokeWidth={fonte * 0.12} paintOrder="stroke">A</text>
                      <text x={r.b.x} y={r.b.y} fill={cor} fontSize={fonte} fontWeight="bold" textAnchor="middle" dominantBaseline="middle" stroke="black" strokeWidth={fonte * 0.12} paintOrder="stroke">B</text>
                      <text x={l.x1 * W} y={l.y1 * H - fonte} fill="white" fontSize={fonte * 0.8} textAnchor="middle" stroke="black" strokeWidth={fonte * 0.12} paintOrder="stroke">{l.nome}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          {!linhas.length && !rascunho && (
            <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-sm text-white">
              Clique e arraste sobre o quadro para desenhar uma linha
            </span>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4 border-line bg-panel px-4 py-3 lg:min-h-0 lg:overflow-y-auto lg:border-l">
        <section className="flex flex-col gap-2">
          <h2 className={TITULO_PAINEL}>Linhas de contagem</h2>
          <p className="text-sm text-muted">
            Uma por ciclovia ou faixa, em qualquer ângulo. Conta quem cruzar; <strong className="text-fg">A→B</strong> e{" "}
            <strong className="text-fg">B→A</strong> são os sentidos. Sem linhas, toda trajetória relevante vira candidata.
          </p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Como posicionar</summary>
            <p className="mt-1">
              O cruzamento usa o ponto em que o objeto toca o chão (base da caixa): a linha deve atravessar só a faixa desejada,
              sem encostar nas vizinhas. Desligue as categorias que uma linha não conta (ex.: automóveis na ciclovia) — elas chegam
              à revisão já propostas como descarte.
            </p>
          </details>
        </section>

        {cameras.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Usar linhas salvas de uma câmera</span>
            <select value={cameraId} onChange={(e) => carregarCamera(e.target.value)} className={CAMPO}>
              <option value="">—</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        {linhas.length > 0 && (
          <ul className="flex flex-col gap-3">
            {linhas.map((l, i) => (
              <li key={l.id} className="flex flex-col gap-2 rounded-md border border-line bg-raised p-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: CORES[i % CORES.length] }} />
                  <input
                    value={l.nome}
                    onChange={(e) => setLinhas(linhas.map((x) => (x.id === l.id ? { ...x, nome: e.target.value } : x)))}
                    className={`${CAMPO} min-w-0 flex-1 py-1`}
                    aria-label={`Nome da linha ${i + 1}`}
                  />
                </div>
                <ChipsCategorias
                  valor={l.categorias}
                  rotulo={`Categorias da linha ${i + 1}`}
                  aoMudar={(v) => setLinhas(linhas.map((x) => (x.id === l.id ? { ...x, categorias: v } : x)))}
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setLinhas(linhas.map((x) => (x.id === l.id ? { ...x, x1: x.x2, y1: x.y2, x2: x.x1, y2: x.y1 } : x)))}
                    className={BOTAO.fantasma}
                    title="Troca os lados A e B"
                  >
                    Inverter A/B
                  </button>
                  <button type="button" onClick={() => setLinhas(linhas.filter((x) => x.id !== l.id))} className={BOTAO.perigo}>
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {pontos && (
          <section className="flex flex-col gap-1.5 text-sm">
            <h2 className={TITULO_PAINEL}>Onde os objetos passaram</h2>
            {(Object.keys(COR_PONTOS) as (keyof Pontos)[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visiveis.has(k)}
                  className="accent-[var(--accent)]"
                  onChange={(e) => {
                    const v = new Set(visiveis);
                    if (e.target.checked) v.add(k);
                    else v.delete(k);
                    setVisiveis(v);
                  }}
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_PONTOS[k].cor }} />
                <span className="flex-1">{COR_PONTOS[k].nome}</span>
                <span className="font-mono text-xs text-faint">{pontos[k]?.length ?? 0}</span>
              </label>
            ))}
          </section>
        )}

        <span className="flex-1" />
        <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={salvarComoCamera} onChange={(e) => setSalvarComoCamera(e.target.checked)} className="accent-[var(--accent)]" />
            Salvar estas linhas como câmera
          </label>
          {salvarComoCamera && (
            <input value={nomeCamera} onChange={(e) => setNomeCamera(e.target.value)} placeholder="Nome da câmera (ex.: CAM 4 Andradas)" className={CAMPO} />
          )}
          <button onClick={enviar} disabled={enviando} className={`${BOTAO.primario} py-2`}>
            {enviando ? "Iniciando…" : linhas.length ? `Detectar com ${linhas.length} linha${linhas.length > 1 ? "s" : ""}` : "Detectar sem linhas"}
          </button>
          {erro && <p className="text-sm text-danger">{erro}</p>}
        </div>
      </aside>
    </div>
  );
}
