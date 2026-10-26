"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Candidato, Linha } from "@/lib/db";
import { NOME_CATEGORIA, type Classe } from "@/lib/revisao";
import { COR_CLASSE, timecode } from "@/lib/ui";
import { timecodeQuadros, useTempo, type Relogio } from "./relogio";

const CAB = 136; // coluna com o nome das trilhas
const PX_MAX = 400; // zoom máximo, em px por segundo (≈ 27 px por quadro a 15 fps)
const ALTURA_PADRAO = 170;
const CHAVE_ALTURA = "contador:alturaTimeline";

type Props = {
  candidatos: Candidato[];
  linhas: Linha[];
  duracao: number;
  fps: number;
  focado: number | null;
  visivel: Set<number>;
  classeDe: (c: Candidato) => Classe | null;
  decidido: (c: Candidato) => boolean;
  numero: Record<number, number>;
  aoFocar: (id: number) => void;
  relogio: Relogio;
  /** onde cada candidato cruza, no tempo do vídeo original */
  tempoDe: (c: Candidato) => number;
  /** o usuário mexeu no cursor pela régua ou pelas trilhas: o monitor passa a mostrar o vídeo */
  aoNavegar: () => void;
};

type Trilha = { chave: string; nome: string; linha: string | null; classe?: Classe | null };

/**
 * Timeline no estilo de um editor de vídeo: régua com o cursor de reprodução
 * (arraste para navegar), uma trilha por linha de contagem — ou por linha ×
 * categoria —, zoom até o quadro (Ctrl+roda, −/+, controle deslizante),
 * arraste no fundo das trilhas para mover a vista e altura ajustável.
 */
export function Timeline({ candidatos, linhas, duracao, fps, focado, visivel, classeDe, decidido, numero, aoFocar, relogio, tempoDe, aoNavegar }: Props) {
  const fim = Math.max(duracao, ...candidatos.map(tempoDe), 1);
  const rolagem = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState(0); // largura útil das trilhas, sem a coluna de nomes
  const [zoom, setZoom] = useState<number | null>(null); // px/s; null = vídeo inteiro na tela
  const [scroll, setScroll] = useState(0);
  const salva = useSyncExternalStore(semAvisos, lerAlturaSalva, () => ALTURA_PADRAO);
  const [alturaManual, setAltura] = useState<number | null>(null);
  const altura = alturaManual ?? salva;
  const [porCategoria, setPorCategoria] = useState(false);
  const ancora = useRef<{ t: number; x: number } | null>(null);

  const ajuste = vista > 0 ? vista / fim : 1;
  const px = Math.min(Math.max(PX_MAX, ajuste), Math.max(ajuste, zoom ?? ajuste));
  const largura = fim * px;
  const estado = useRef({ px, vista });
  useLayoutEffect(() => {
    estado.current = { px, vista };
  });

  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVista(Math.max(0, el.clientWidth - CAB)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // mantém o mesmo instante sob o mouse (ou sob o cursor) ao mudar o zoom
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (el && ancora.current) {
      el.scrollLeft = ancora.current.t * px - ancora.current.x;
      ancora.current = null;
      setScroll(el.scrollLeft);
    }
  }, [px]);

  function mudarZoom(novo: number, t?: number, x?: number) {
    const el = rolagem.current;
    if (!el) return;
    const { px: atual, vista: v } = estado.current;
    if (t === undefined || x === undefined) {
      const xc = relogio.tempo() * atual - el.scrollLeft;
      if (xc >= 0 && xc <= v) [t, x] = [relogio.tempo(), xc];
      else [t, x] = [(el.scrollLeft + v / 2) / atual, v / 2];
    }
    ancora.current = { t, x };
    setZoom(Math.min(PX_MAX, Math.max(v / fim, novo)));
  }

  // Ctrl+roda = zoom no ponto do mouse (precisa de listener não passivo para impedir o zoom da página)
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    function roda(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      const x = Math.max(0, e.clientX - r.left - CAB);
      const { px: atual } = estado.current;
      mudarZoom(atual * Math.exp(-e.deltaY * 0.0025), (el!.scrollLeft + x) / atual, x);
    }
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  });

  // + / − / \ como nos editores
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(alvo.tagName)) return;
      if (e.key === "+" || e.key === "=") mudarZoom(estado.current.px * 1.6);
      else if (e.key === "-" || e.key === "_") mudarZoom(estado.current.px / 1.6);
      else if (e.key === "\\") setZoom(null);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  // o cursor saiu da vista enquanto o vídeo toca ou ao escolher um candidato: a vista acompanha
  useEffect(
    () =>
      relogio.ouvir((t, origem) => {
        const el = rolagem.current;
        if (!el || origem === "usuario") return;
        const { px: p, vista: v } = estado.current;
        const x = t * p - el.scrollLeft;
        if (x >= 8 && x <= v - 8) return;
        el.scrollLeft = origem === "video" ? t * p - v * 0.1 : t * p - v / 2;
      }),
    [relogio],
  );

  const trilhas: Trilha[] = useMemo(() => {
    const base = linhas.length ? linhas.map((l) => ({ id: l.id as string | null, nome: l.nome })) : [{ id: null, nome: "Candidatos" }];
    if (!porCategoria) return base.map((l) => ({ chave: l.id ?? "-", nome: l.nome, linha: l.id }));
    return base.flatMap((l) => {
      const daLinha = candidatos.filter((c) => l.id === null || c.linha_id === l.id);
      const classes = [...new Set(daLinha.map((c) => classeDe(c)))].sort((a, b) => ordemClasse(a) - ordemClasse(b));
      return classes.map((classe) => ({
        chave: `${l.id ?? "-"}:${classe ?? "?"}`,
        nome: `${l.nome} · ${classe ? (classe === "descartado" ? "Descartar" : NOME_CATEGORIA[classe]) : "sem sugestão"}`,
        linha: l.id,
        classe,
      }));
    });
  }, [linhas, candidatos, porCategoria, classeDe]);

  // marcas da régua: a maior que cabe com ~80 px entre os rótulos; subdivisões de ≥ 8 px
  const passos = [1 / fps, 2 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const passo = passos.find((p) => p * px >= 80) ?? 3600;
  const menor = passos.filter((p) => p < passo && Math.abs(passo / p - Math.round(passo / p)) < 1e-6).find((p) => p * px >= 8);
  const t0 = scroll / px;
  const t1 = (scroll + vista) / px;
  const marcas: number[] = [];
  for (let k = Math.max(0, Math.floor(t0 / passo)); k * passo <= Math.min(fim, t1 + passo); k++) marcas.push(k * passo);
  const rotulo = (s: number) => (passo < 1 ? timecodeQuadros(s, fps) : timecode(s, fim >= 3600));

  const fatorAjuste = PX_MAX / Math.max(ajuste, 1e-9);
  const posSlider = fatorAjuste > 1 ? Math.round((Math.log(px / ajuste) / Math.log(fatorAjuste)) * 1000) : 0;

  /** posição x (no conteúdo das trilhas) → tempo */
  function tempoEm(clientX: number) {
    const el = rolagem.current!;
    return (clientX - el.getBoundingClientRect().left - CAB + el.scrollLeft) / px;
  }

  function arrastarRegua(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    relogio.buscar(tempoEm(e.clientX), "usuario");
    aoNavegar();
    const mover = (ev: PointerEvent) => relogio.buscar(tempoEm(ev.clientX), "usuario");
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  /** arrastar o fundo move a vista (como a "mão" do editor); um clique sem arrastar leva o cursor até ali */
  function arrastarFundo(e: React.PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const el = rolagem.current!;
    e.preventDefault();
    const ini = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    let moveu = false;
    el.style.cursor = "grabbing";
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - ini.x;
      const dy = ev.clientY - ini.y;
      if (!moveu && Math.hypot(dx, dy) < 4) return;
      moveu = true;
      el.scrollLeft = ini.l - dx;
      el.scrollTop = ini.t - dy;
    };
    const soltar = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      el.style.cursor = "";
      if (!moveu && e.button === 0) {
        relogio.buscar(tempoEm(ev.clientX), "usuario");
        aoNavegar();
      }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function redimensionar(e: React.PointerEvent) {
    e.preventDefault();
    const ini = { y: e.clientY, a: altura };
    let final = altura;
    const mover = (ev: PointerEvent) => {
      final = Math.round(Math.min(window.innerHeight * 0.7, Math.max(90, ini.a - (ev.clientY - ini.y))));
      setAltura(final);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      try {
        localStorage.setItem(CHAVE_ALTURA, String(final));
      } catch {}
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  return (
    <section className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height: altura }} aria-label="Linha do tempo" data-testid="timeline">
      <div
        onPointerDown={redimensionar}
        className="-mt-1 h-2 shrink-0 cursor-row-resize hover:bg-accent/30"
        title="Arraste para aumentar ou diminuir a linha do tempo"
        role="separator"
        aria-orientation="horizontal"
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 pb-1 text-xs">
        <TempoAtual relogio={relogio} fps={fps} fim={fim} />
        <span className="hidden text-faint md:inline">Arraste a régua para navegar · arraste as trilhas para mover · Ctrl+roda dá zoom</span>
        <span className="flex-1" />
        <label className="flex cursor-pointer items-center gap-1.5 text-muted">
          <input type="checkbox" checked={porCategoria} onChange={(e) => setPorCategoria(e.target.checked)} />
          Uma trilha por categoria
        </label>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => mudarZoom(px / 1.6)} className="rounded px-1.5 font-mono text-muted hover:bg-hover hover:text-fg" title="Afastar (−)" aria-label="Afastar">
            −
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={posSlider}
            disabled={fatorAjuste <= 1}
            onChange={(e) => mudarZoom(ajuste * Math.pow(fatorAjuste, Number(e.target.value) / 1000))}
            className="w-28 accent-[var(--accent)]"
            aria-label="Zoom da linha do tempo"
          />
          <button type="button" onClick={() => mudarZoom(px * 1.6)} className="rounded px-1.5 font-mono text-muted hover:bg-hover hover:text-fg" title="Aproximar (+)" aria-label="Aproximar">
            +
          </button>
          <button type="button" onClick={() => setZoom(null)} className="rounded px-1.5 text-muted hover:bg-hover hover:text-fg" title="Mostrar o vídeo inteiro (\)">
            Ajustar
          </button>
        </span>
      </div>

      <div ref={rolagem} onScroll={(e) => setScroll(e.currentTarget.scrollLeft)} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        <div className="relative" style={{ width: CAB + largura, minHeight: "100%" }}>
          {/* régua */}
          <div className="sticky top-0 z-20 flex h-6">
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-line bg-panel px-3 font-mono text-[0.7rem] text-faint" style={{ width: CAB }}>
              {timecode(fim, true)}
            </div>
            <div
              onPointerDown={arrastarRegua}
              className="relative cursor-ew-resize overflow-hidden border-b border-line bg-panel"
              style={{
                width: largura,
                backgroundImage: menor ? "linear-gradient(to right, var(--line) 1px, transparent 1px)" : undefined,
                backgroundSize: menor ? `${menor * px}px 5px` : undefined,
                backgroundRepeat: "repeat-x",
                backgroundPosition: "left bottom",
              }}
              title="Arraste para navegar no vídeo"
            >
              {marcas.map((s) => (
                <span key={s} className="pointer-events-none absolute top-0 flex h-full items-start border-l border-faint/60 pl-1 pt-0.5 font-mono text-[0.65rem] text-faint" style={{ left: s * px }}>
                  {rotulo(s)}
                </span>
              ))}
              <Cursor relogio={relogio} px={px} alca />
            </div>
          </div>

          {trilhas.map((t) => {
            const nela = candidatos
              .filter((c) => (t.linha === null || c.linha_id === t.linha) && (t.classe === undefined || classeDe(c) === t.classe))
              .sort((a, b) => tempoDe(a) - tempoDe(b));
            return (
              <div key={t.chave} className="flex h-9">
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-r border-line bg-panel px-3 text-xs font-medium text-muted" style={{ width: CAB }} title={t.nome}>
                  {t.classe !== undefined && <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${t.classe ? COR_CLASSE[t.classe].fundo : "border border-faint"}`} />}
                  <span className="truncate">{t.nome}</span>
                </div>
                <div onPointerDown={arrastarFundo} className="relative cursor-grab overflow-hidden border-b border-line bg-raised/50" style={{ width: largura }}>
                  {nela.map((c, i) => {
                    const x = tempoDe(c) * px;
                    if (x < scroll - 200 || x > scroll + vista + 200) return null;
                    const classe = classeDe(c);
                    const cor = classe ? COR_CLASSE[classe] : null;
                    const ok = decidido(c);
                    const ativo = c.id === focado;
                    const espaco = i + 1 < nela.length ? (tempoDe(nela[i + 1]) - tempoDe(c)) * px : Infinity;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => aoFocar(c.id)}
                        title={`#${numero[c.id]} · ${classe ? NOME_CATEGORIA[classe] : "sem sugestão"} · ${timecodeQuadros(tempoDe(c), fps)}`}
                        aria-label={`Ir para o candidato ${numero[c.id]}`}
                        className={`group absolute bottom-1.5 top-1.5 flex items-center ${visivel.has(c.id) ? "" : "opacity-25"}`}
                        style={{ left: x - 2 }}
                      >
                        <span
                          className={`h-full w-1 rounded-[1px] ${ok ? (cor?.fundo ?? "bg-faint") : `border ${cor?.borda ?? "border-faint"} bg-transparent`} ${
                            ativo ? "outline outline-2 outline-offset-1 outline-accent" : ""
                          } group-hover:scale-y-110`}
                        />
                        {espaco >= 40 && <span className={`pl-1 font-mono text-[0.65rem] ${ativo ? "font-semibold text-fg" : "text-faint"}`}>#{numero[c.id]}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* área vazia abaixo das trilhas também arrasta */}
          <div onPointerDown={arrastarFundo} className="cursor-grab" style={{ marginLeft: CAB, height: 24 }} />

          <div className="pointer-events-none absolute bottom-0 top-6 z-[5]" style={{ left: CAB }}>
            <Cursor relogio={relogio} px={px} />
          </div>
        </div>
      </div>
    </section>
  );
}

const semAvisos = () => () => {};
function lerAlturaSalva(): number {
  try {
    const salva = Number(localStorage.getItem(CHAVE_ALTURA));
    return salva >= 90 ? salva : ALTURA_PADRAO;
  } catch {
    return ALTURA_PADRAO;
  }
}

const ORDEM_CLASSES: (Classe | null)[] = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "motocicletas", "automoveis", "outros", "descartado", null];
const ordemClasse = (c: Classe | null) => ORDEM_CLASSES.indexOf(c);

/** O cursor de reprodução; só ele redesenha enquanto o vídeo toca. */
function Cursor({ relogio, px, alca = false }: { relogio: Relogio; px: number; alca?: boolean }) {
  const t = useTempo(relogio);
  return (
    <span className="pointer-events-none absolute top-0 h-full" style={{ left: t * px }} aria-hidden>
      <span className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-accent" />
      {alca && <span className="absolute -top-px h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-accent" />}
    </span>
  );
}

function TempoAtual({ relogio, fps, fim }: { relogio: Relogio; fps: number; fim: number }) {
  const t = useTempo(relogio);
  return (
    <span className="font-mono tabular-nums">
      <span className="text-accent-text">{timecodeQuadros(t, fps)}</span>
      <span className="text-faint"> / {timecode(fim, true)}</span>
    </span>
  );
}
