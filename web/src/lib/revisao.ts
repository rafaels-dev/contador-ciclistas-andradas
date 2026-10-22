import type { Candidato, Categoria, Linha } from "./db";

/**
 * Regras da revisão humana, compartilhadas entre servidor e navegador (só
 * imports de tipo de ./db: o node:sqlite não pode ir para o bundle do cliente).
 */

export type Classe = Categoria | "descartado";

export const CLASSES: readonly Classe[] = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "automoveis", "motocicletas", "outros", "descartado"];

export const NOME_CATEGORIA: Record<Classe, string> = {
  ciclistas: "Ciclista",
  patinetes: "Patinete",
  scooters: "Scooter elétrico",
  monociclos: "Monociclo",
  pedestres: "Pedestre",
  automoveis: "Automóvel",
  motocicletas: "Motocicleta",
  outros: "Outros",
  descartado: "Nada / descartar",
};

/** Categorias que uma linha conta; sem lista (ou lista vazia) = todas. */
export function contaNaLinha(linha: Linha | undefined, classe: Categoria): boolean {
  return !linha?.categorias?.length || linha.categorias.includes(classe);
}

export type Proposta = {
  classe: Classe | null;
  /** o modelo viu uma categoria que esta linha não conta (ex.: ônibus na linha da ciclovia) */
  foraDaLinha: Categoria | null;
};

/**
 * O que a tela oferece para o humano aceitar: a sugestão do modelo de visão,
 * trocada por "descartado" quando a categoria não é contada na linha cruzada.
 */
export function proposta(c: Candidato, linhas: Record<string, Linha>): Proposta {
  const s = c.status_llm === "ok" ? c.sugestao_llm : null;
  if (!s) return { classe: null, foraDaLinha: null };
  if (s !== "descartado" && c.linha_id && !contaNaLinha(linhas[c.linha_id], s)) {
    return { classe: "descartado", foraDaLinha: s };
  }
  return { classe: s, foraDaLinha: null };
}

export type Totais = {
  /** linha → categoria → sentido ('A→B' | 'B→A' | '—') → n */
  porLinha: Record<string, Partial<Record<Categoria, Record<string, number>>>>;
  pendentes: number;
  descartados: number;
  contados: number;
};

/** Totais só com decisões humanas (rotulo) — é o que vai para o vídeo final. */
export function calcularTotais(candidatos: Pick<Candidato, "linha_id" | "direcao" | "rotulo">[]): Totais {
  const t: Totais = { porLinha: {}, pendentes: 0, descartados: 0, contados: 0 };
  for (const c of candidatos) {
    if (!c.rotulo) t.pendentes++;
    else if (c.rotulo === "descartado") t.descartados++;
    else {
      t.contados++;
      const linha = (t.porLinha[c.linha_id ?? ""] ??= {});
      const cat = (linha[c.rotulo] ??= {});
      const sentido = c.direcao ?? "—";
      cat[sentido] = (cat[sentido] ?? 0) + 1;
    }
  }
  return t;
}
