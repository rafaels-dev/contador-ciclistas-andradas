import { describe, expect, it } from "vitest";
import type { Candidato, Linha } from "./db";
import { calcularTotais, contaNaLinha, lerErroSugestao, possiveisDuplicados, proposta, type Classe } from "./revisao";

function candidato(campos: Partial<Candidato>): Candidato {
  return {
    id: 1, job_id: "j", track: "bic:1", linha_id: "l1", frame: 0, tempo_s: 0, direcao: "A→B", bbox: null,
    classe_yolo: "ciclistas", conf_yolo: 0.8, alternativa: null, origem: "track", n_obs: 10,
    filmstrip: null, contexto: null, clipe: null, sugestao_llm: null, custo_llm: null, conf_llm: null,
    justificativa_llm: null, modelo_llm: null, status_llm: "pendente", erro_llm: null, rotulo: null, revisado_em: null,
    ...campos,
  };
}

const linha = (categorias?: Linha["categorias"]): Linha => ({ id: "l1", nome: "Ciclovia", x1: 0, y1: 0, x2: 1, y2: 1, categorias });

describe("contaNaLinha", () => {
  it("sem lista de categorias, a linha conta tudo", () => {
    expect(contaNaLinha(linha(), "automoveis")).toBe(true);
    expect(contaNaLinha(linha([]), "automoveis")).toBe(true);
    expect(contaNaLinha(undefined, "automoveis")).toBe(true);
  });

  it("com lista, só as categorias dela", () => {
    expect(contaNaLinha(linha(["ciclistas"]), "ciclistas")).toBe(true);
    expect(contaNaLinha(linha(["ciclistas"]), "automoveis")).toBe(false);
  });
});

describe("proposta", () => {
  const ciclovia = { l1: linha(["ciclistas", "patinetes"]) };

  it("sem sugestão ainda, não propõe nada", () => {
    expect(proposta(candidato({ status_llm: "pendente" }), ciclovia)).toEqual({ classe: null, foraDaLinha: null, doDetector: false });
  });

  it("propõe a sugestão do modelo de visão", () => {
    const c = candidato({ status_llm: "ok", sugestao_llm: "ciclistas" });
    expect(proposta(c, ciclovia)).toEqual({ classe: "ciclistas", foraDaLinha: null, doDetector: false });
  });

  it("categoria que a linha não conta vira descarte, guardando o que o modelo viu", () => {
    const c = candidato({ status_llm: "ok", sugestao_llm: "automoveis" });
    expect(proposta(c, ciclovia)).toEqual({ classe: "descartado", foraDaLinha: "automoveis", doDetector: false });
  });

  it("descarte do modelo continua descarte", () => {
    const c = candidato({ status_llm: "ok", sugestao_llm: "descartado" });
    expect(proposta(c, ciclovia).classe).toBe("descartado");
    expect(proposta(c, ciclovia).foraDaLinha).toBeNull();
  });

  it("se a IA falhou, propõe a classe do detector, marcada como tal", () => {
    const c = candidato({ status_llm: "falhou", classe_yolo: "pedestres" });
    expect(proposta(c, { l1: linha() })).toEqual({ classe: "pedestres", foraDaLinha: null, doDetector: true });
  });

  it("candidato sem linha (vídeo sem linhas) não é filtrado", () => {
    const c = candidato({ linha_id: null, status_llm: "ok", sugestao_llm: "automoveis" });
    expect(proposta(c, ciclovia).classe).toBe("automoveis");
  });
});

describe("lerErroSugestao", () => {
  it("lê o JSON guardado pelo servidor", () => {
    const erro = { status: 400, tentativas: 3, mensagem: "Provider returned error" };
    expect(lerErroSugestao({ erro_llm: JSON.stringify(erro) })).toEqual(erro);
  });

  it("sem erro ou com texto inválido, null", () => {
    expect(lerErroSugestao({ erro_llm: null })).toBeNull();
    expect(lerErroSugestao({ erro_llm: "não é json" })).toBeNull();
  });
});

describe("calcularTotais", () => {
  it("conta só decisões humanas, por linha, categoria e sentido", () => {
    const t = calcularTotais([
      { linha_id: "l1", direcao: "A→B", rotulo: "ciclistas" },
      { linha_id: "l1", direcao: "A→B", rotulo: "ciclistas" },
      { linha_id: "l1", direcao: "B→A", rotulo: "ciclistas" },
      { linha_id: "l2", direcao: "A→B", rotulo: "pedestres" },
      { linha_id: null, direcao: null, rotulo: "outros" },
      { linha_id: "l1", direcao: "A→B", rotulo: "descartado" },
      { linha_id: "l1", direcao: "A→B", rotulo: null },
    ]);
    expect(t.porLinha).toEqual({
      l1: { ciclistas: { "A→B": 2, "B→A": 1 } },
      l2: { pedestres: { "A→B": 1 } },
      "": { outros: { "—": 1 } },
    });
    expect([t.contados, t.descartados, t.pendentes]).toEqual([5, 1, 1]);
  });
});

describe("possiveisDuplicados", () => {
  type C = Parameters<typeof possiveisDuplicados>[0][number];
  const c = (id: number, tempo_s: number, bbox: number[] | null, extra: Partial<C> = {}): C => ({
    id, linha_id: "l1", direcao: "A→B", tempo_s, bbox: bbox && JSON.stringify(bbox), ...extra,
  });
  const todosCiclistas = (): Classe => "ciclistas";

  it("mesma linha, sentido e classe, perto no tempo e com caixas sobrepostas", () => {
    const pares = possiveisDuplicados([c(1, 10, [0, 0, 100, 100]), c(2, 10.5, [20, 20, 110, 110])], todosCiclistas);
    expect(pares.get(1)).toEqual([2]);
    expect(pares.get(2)).toEqual([1]);
  });

  it("longe no tempo, não", () => {
    const pares = possiveisDuplicados([c(1, 10, [0, 0, 100, 100]), c(2, 11.5, [0, 0, 100, 100])], todosCiclistas);
    expect(pares.size).toBe(0);
  });

  it("caixas separadas, não (dois ciclistas lado a lado)", () => {
    const pares = possiveisDuplicados([c(1, 10, [0, 0, 100, 100]), c(2, 10.2, [200, 0, 300, 100])], todosCiclistas);
    expect(pares.size).toBe(0);
  });

  it("sentido, linha ou classe diferentes, não", () => {
    const base = c(1, 10, [0, 0, 100, 100]);
    expect(possiveisDuplicados([base, c(2, 10, [0, 0, 100, 100], { direcao: "B→A" })], todosCiclistas).size).toBe(0);
    expect(possiveisDuplicados([base, c(2, 10, [0, 0, 100, 100], { linha_id: "l2" })], todosCiclistas).size).toBe(0);
    const classes: Record<number, Classe> = { 1: "ciclistas", 2: "pedestres" };
    expect(possiveisDuplicados([base, c(2, 10, [0, 0, 100, 100])], (id) => classes[id]).size).toBe(0);
  });

  it("descartados e sem classe ficam de fora", () => {
    const lista = [c(1, 10, [0, 0, 100, 100]), c(2, 10, [0, 0, 100, 100])];
    expect(possiveisDuplicados(lista, () => "descartado").size).toBe(0);
    expect(possiveisDuplicados(lista, () => null).size).toBe(0);
  });

  it("ordem de entrada não importa", () => {
    const pares = possiveisDuplicados([c(2, 10.5, [0, 0, 100, 100]), c(3, 30, null), c(1, 10, [0, 0, 100, 100])], todosCiclistas);
    expect(pares.get(1)).toEqual([2]);
    expect(pares.has(3)).toBe(false);
  });
});
