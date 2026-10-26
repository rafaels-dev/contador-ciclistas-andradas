import type { Candidato, Categoria, Linha } from "./db";

/**
 * Regras da revisão humana, compartilhadas entre servidor e navegador (só
 * imports de tipo de ./db: o node:sqlite não pode ir para o bundle do cliente).
 */

export type Classe = Categoria | "descartado";

/**
 * modelo_llm de quem não passou pelo modelo de visão: carro do YOLO numa linha
 * que não conta automóveis (a proposta já é descartar). Entra no aceite em lote.
 */
export const SEM_CONSULTA = "detector";

export const CLASSES: readonly Classe[] = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "automoveis", "motocicletas", "outros", "descartado"];

/** As categorias contadas (CLASSES sem "descartado"), para o navegador — db.ts não pode ir ao bundle do cliente. */
export const CATEGORIAS_CONTADAS: readonly Categoria[] = CLASSES.filter((c): c is Categoria => c !== "descartado");

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
  /** a IA falhou: a proposta é a classe do detector (YOLO), sem confiança — nunca entra no aceite em lote */
  doDetector: boolean;
};

/**
 * O que a tela oferece para o humano aceitar: a sugestão do modelo de visão,
 * trocada por "descartado" quando a categoria não é contada na linha cruzada.
 * Se a IA falhou nesse candidato, vale a classe do detector, marcada como tal.
 */
export function proposta(c: Candidato, linhas: Record<string, Linha>): Proposta {
  const doDetector = c.status_llm === "falhou";
  const s = c.status_llm === "ok" ? c.sugestao_llm : doDetector ? c.classe_yolo : null;
  if (!s) return { classe: null, foraDaLinha: null, doDetector };
  if (s !== "descartado" && c.linha_id && !contaNaLinha(linhas[c.linha_id], s)) {
    return { classe: "descartado", foraDaLinha: s, doDetector };
  }
  return { classe: s, foraDaLinha: null, doDetector };
}

/** Erro guardado pelo servidor quando a sugestão falhou (JSON em candidatos.erro_llm). */
export type ErroSugestao = { quando?: string; status?: number | null; tentativas?: number; mensagem?: string; detalhe?: string | null };

export function lerErroSugestao(c: Pick<Candidato, "erro_llm">): ErroSugestao | null {
  if (!c.erro_llm) return null;
  try {
    return JSON.parse(c.erro_llm) as ErroSugestao;
  } catch {
    return null;
  }
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

/** Dois cruzamentos do mesmo objeto chegam juntos; objetos diferentes na mesma faixa vêm espaçados. */
export const JANELA_DUPLICADO_S = 1;

function sobreposicao(a: number[], b: number[]): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const area = (c: number[]) => (c[2] - c[0]) * (c[3] - c[1]);
  return (w * h) / Math.min(area(a), area(b));
}

/**
 * Possível dupla contagem do mesmo objeto (ex.: o modelo olhou o ciclista ao
 * lado do carro, ou o rastreio partiu um objeto em dois): mesma linha e
 * sentido, mesma classe, cruzando a até JANELA_DUPLICADO_S com as caixas
 * sobrepostas. Só aponta para o humano conferir — não descarta nada.
 * Devolve id → ids dos candidatos parecidos.
 */
export function possiveisDuplicados(
  candidatos: Pick<Candidato, "id" | "linha_id" | "direcao" | "tempo_s" | "bbox">[],
  classeDe: (id: number) => Classe | null,
): Map<number, number[]> {
  const pares = new Map<number, number[]>();
  const ordem = [...candidatos].sort((a, b) => a.tempo_s - b.tempo_s);
  const caixa = (c: (typeof ordem)[number]) => (c.bbox ? (JSON.parse(c.bbox) as number[]) : null);
  for (let i = 0; i < ordem.length; i++) {
    const a = ordem[i];
    const ca = classeDe(a.id);
    if (!ca || ca === "descartado") continue;
    for (let j = i + 1; j < ordem.length && ordem[j].tempo_s - a.tempo_s <= JANELA_DUPLICADO_S; j++) {
      const b = ordem[j];
      if (b.linha_id !== a.linha_id || b.direcao !== a.direcao || classeDe(b.id) !== ca) continue;
      const [xa, xb] = [caixa(a), caixa(b)];
      if (!xa || !xb || sobreposicao(xa, xb) < 0.3) continue;
      pares.set(a.id, [...(pares.get(a.id) ?? []), b.id]);
      pares.set(b.id, [...(pares.get(b.id) ?? []), a.id]);
    }
  }
  return pares;
}
