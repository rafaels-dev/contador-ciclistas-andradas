"use client";

import type { Categoria } from "@/lib/db";
import { CATEGORIAS_CONTADAS as CATEGORIAS, NOME_CATEGORIA } from "@/lib/revisao";
import { COR_CLASSE } from "@/lib/ui";

/**
 * Quais categorias entram no vídeo final e na contagem. Sem escolha (null)
 * = todas; a lista fica gravada no render, e "Gerar de novo" a mantém.
 */
export function todasCategorias(sel: readonly Categoria[] | null): boolean {
  return !sel || sel.length === CATEGORIAS.length;
}

export function EscolhaCategorias({ valor, aoMudar }: { valor: Categoria[]; aoMudar: (v: Categoria[]) => void }) {
  const alternar = (c: Categoria) => aoMudar(valor.includes(c) ? valor.filter((x) => x !== c) : CATEGORIAS.filter((x) => x === c || valor.includes(x)));
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="escolha-categorias">
      <legend className="text-xs text-muted">
        O que entra no vídeo final e na contagem
        {valor.length < CATEGORIAS.length && (
          <button type="button" onClick={() => aoMudar([...CATEGORIAS])} className="ml-2 text-accent-text hover:underline">
            marcar todas
          </button>
        )}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIAS.map((c) => {
          const marcada = valor.includes(c);
          return (
            <button
              key={c}
              type="button"
              role="checkbox"
              aria-checked={marcada}
              onClick={() => alternar(c)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${marcada ? `${COR_CLASSE[c].borda} bg-raised text-fg` : "border-line text-faint line-through hover:text-muted"}`}
            >
              <span className={`h-2 w-2 rounded-full ${marcada ? COR_CLASSE[c].fundo : "bg-faint"}`} aria-hidden />
              {NOME_CATEGORIA[c]}
            </button>
          );
        })}
      </div>
      {!valor.length && <p className="text-xs text-danger">Marque pelo menos uma categoria.</p>}
    </fieldset>
  );
}
