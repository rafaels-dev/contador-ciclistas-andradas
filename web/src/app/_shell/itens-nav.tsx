"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CAMPO } from "@/lib/ui";
import { criarGrupo } from "./actions";

const ICONES = {
  todos: <path d="M2 4.5h12M2 8h12M2 11.5h12" />,
  grupo: <path d="M1.75 4.25c0-.6.4-1 1-1h3.5l1.5 1.5h5.5c.6 0 1 .4 1 1v6.5c0 .6-.4 1-1 1H2.75c-.6 0-1-.4-1-1Z" />,
  solto: <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />,
  exportar: <path d="M8 2v8M4.75 6.75 8 10l3.25-3.25M2.5 13.5h11" />,
  config: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
};

type Props = {
  href: string;
  /** grupo que o item representa (null = todos; undefined = não é item de grupo) */
  grupo: string | null | undefined;
  n: number | null;
  icone: keyof typeof ICONES;
  children: React.ReactNode;
};

export function ItemNav({ href, grupo, n, icone, children }: Props) {
  const caminho = usePathname();
  const params = useSearchParams();
  const ativo = grupo === undefined ? caminho.startsWith(href) : caminho === "/" && (params.get("grupo") ?? null) === grupo;
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
        ativo ? "bg-raised font-medium text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg"
      }`}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONES[icone]}
      </svg>
      <span className="flex-1 truncate">{children}</span>
      {n !== null && <span className="font-mono text-[0.7rem] tabular-nums text-faint">{n}</span>}
    </Link>
  );
}

export function NovoGrupo() {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [enviando, iniciar] = useTransition();

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-faint hover:bg-hover hover:text-fg">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Novo grupo
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-1.5 px-1 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(() => criarGrupo(nome));
      }}
    >
      <input
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAberto(false)}
        placeholder="Nome (ex.: Augusto de Lima)"
        aria-label="Nome do novo grupo"
        className={`${CAMPO} w-full`}
        disabled={enviando}
      />
      <span className="text-[0.7rem] text-faint">Enter cria · Esc cancela</span>
    </form>
  );
}
