"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { BOTAO, CAMPO } from "@/lib/ui";
import { criarJobsLocais, navegarPasta, type EstadoPasta } from "./actions";

const CHAVE_ULTIMA = "contador:ultima-pasta";

function tamanho(bytes = 0): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : `${Math.round(bytes / 1e6)} MB`;
}

const ICONE_PASTA = <path d="M1.75 4.25c0-.6.4-1 1-1h3.5l1.5 1.5h5.5c.6 0 1 .4 1 1v6.5c0 .6-.4 1-1 1H2.75c-.6 0-1-.4-1-1Z" />;
const ICONE_VIDEO = (
  <>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="m6.75 6 3 2-3 2Z" />
  </>
);

function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** Escolhe vídeos que já estão no computador — o app os lê onde estão, sem copiar. */
export function SeletorLocal({ grupo }: { grupo: string }) {
  const [estado, setEstado] = useState<EstadoPasta | null>(null);
  const [digitado, setDigitado] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [ocupado, iniciar] = useTransition();
  // app desktop: diálogo nativo de arquivos (só existe depois da hidratação)
  const nativo = useSyncExternalStore(
    () => () => {},
    () => !!window.contadorDesktop?.escolherVideos,
    () => false,
  );

  function abrir(caminho: string | null) {
    iniciar(async () => {
      const novo = await navegarPasta(caminho);
      setEstado(novo);
      if (novo.conteudo) {
        setDigitado(novo.conteudo.caminho);
        setMarcados(novo.selecionado ? [novo.selecionado] : []);
        try {
          localStorage.setItem(CHAVE_ULTIMA, novo.conteudo.caminho);
        } catch {}
      }
    });
  }

  // abre na última pasta usada (ou na pasta do usuário)
  useEffect(() => {
    let ultima: string | null = null;
    try {
      ultima = localStorage.getItem(CHAVE_ULTIMA);
    } catch {}
    abrir(ultima);
  }, []);

  const c = estado?.conteudo;
  return (
    <div className="flex flex-col gap-3" data-testid="seletor-local">
      {nativo && (
        <button
          type="button"
          disabled={ocupado}
          className={`${BOTAO.primario} self-start`}
          onClick={async () => {
            const caminhos = (await window.contadorDesktop?.escolherVideos?.()) ?? [];
            if (caminhos.length) iniciar(() => criarJobsLocais(caminhos, grupo || null));
          }}
        >
          Escolher vídeos…
        </button>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          abrir(digitado);
        }}
      >
        <input
          value={digitado}
          onChange={(e) => setDigitado(e.target.value)}
          aria-label="Caminho da pasta ou do vídeo"
          placeholder="Cole o caminho de uma pasta ou de um vídeo"
          className={`${CAMPO} min-w-0 flex-1 font-mono text-xs`}
        />
        <button className={BOTAO.secundario}>Ir</button>
      </form>

      {estado && estado.raizes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {estado.raizes.map((r) => (
            <button key={r.caminho} type="button" onClick={() => abrir(r.caminho)} className="rounded border border-line bg-raised px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg">
              {r.nome}
            </button>
          ))}
        </div>
      )}

      {estado?.erro && <p className="text-sm text-danger">{estado.erro}</p>}

      <ul className={`h-72 overflow-y-auto rounded-md border border-line bg-raised text-sm ${ocupado ? "opacity-50" : ""}`}>
        {!estado && <li className="px-3 py-1.5 text-faint">Abrindo…</li>}
        {c?.pai && (
          <li>
            <button type="button" onClick={() => abrir(c.pai)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:bg-hover">
              <Icone>
                <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
              </Icone>
              Pasta acima
            </button>
          </li>
        )}
        {c?.pastas.map((p) => (
          <li key={p.caminho}>
            <button type="button" onClick={() => abrir(p.caminho)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover">
              <Icone>{ICONE_PASTA}</Icone>
              <span className="truncate">{p.nome}</span>
            </button>
          </li>
        ))}
        {c?.videos.map((v) => (
          <li key={v.caminho}>
            <label className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-hover ${marcados.includes(v.caminho) ? "bg-accent/10" : ""}`}>
              <input
                type="checkbox"
                checked={marcados.includes(v.caminho)}
                onChange={(e) => setMarcados((m) => (e.target.checked ? [...m, v.caminho] : m.filter((x) => x !== v.caminho)))}
                className="accent-[var(--accent)]"
              />
              <Icone>{ICONE_VIDEO}</Icone>
              <span className="flex-1 truncate">{v.nome}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{tamanho(v.bytes)}</span>
            </label>
          </li>
        ))}
        {c && !c.pastas.length && !c.videos.length && <li className="px-3 py-1.5 text-faint">Nenhum vídeo nem pasta aqui.</li>}
      </ul>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!marcados.length || ocupado} onClick={() => iniciar(() => criarJobsLocais(marcados, grupo || null))} className={BOTAO.primario}>
          Importar {marcados.length || ""} vídeo{marcados.length === 1 ? "" : "s"}
        </button>
        {c && c.videos.length > 1 && (
          <button type="button" onClick={() => setMarcados(marcados.length === c.videos.length ? [] : c.videos.map((v) => v.caminho))} className={BOTAO.fantasma}>
            {marcados.length === c.videos.length ? "Desmarcar todos" : "Marcar todos desta pasta"}
          </button>
        )}
      </div>
    </div>
  );
}
