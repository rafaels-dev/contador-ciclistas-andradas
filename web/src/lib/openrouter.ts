import fs from "node:fs";

/**
 * Sugestão de classificação de um candidato por um modelo de visão via
 * OpenRouter. Sem imports com alias "@/": o script de calibração
 * (web/scripts/calibrar.ts) roda este mesmo código fora do Next.
 */

export const SUGESTOES = ["ciclistas", "pedestres", "automoveis", "motocicletas", "descartado"] as const;
export type Sugestao = (typeof SUGESTOES)[number];

const ROTULO_PROMPT: Record<Sugestao, string> = {
  ciclistas: "ciclista",
  pedestres: "pedestre",
  automoveis: "automovel",
  motocicletas: "motocicleta",
  descartado: "nenhum",
};
const DO_PROMPT = Object.fromEntries(Object.entries(ROTULO_PROMPT).map(([k, v]) => [v, k as Sugestao]));

export const MODELO_PADRAO = "google/gemini-2.5-flash-lite";

const INSTRUCOES = `Você classifica objetos em movimento vistos por uma câmera fixa de trânsito (rua com ciclovia, calçada e pista de veículos). Pode ser dia ou noite; à noite há borrão de movimento forte e faróis.

Você recebe:
- FILMSTRIP: recortes do MESMO objeto ao longo do tempo (da esquerda para a direita), com uma margem acima do veículo para incluir o condutor.
- CONTEXTO (se houver): o quadro do momento em que o objeto cruza a linha de contagem (linhas amarelas), recortado em volta dele; a caixa colorida marca o objeto.

Categorias:
- ciclista: pessoa montada em bicicleta (inclui bicicleta elétrica de pedal).
- pedestre: pessoa a pé, andando ou correndo.
- motocicleta: moto, motoneta ou scooter motorizada (com piloto e garupa contam como uma só).
- automovel: carro, van, ônibus, caminhão.
- nenhum: não há objeto real em movimento (sombra, reflexo, farol, árvore, objeto parado, recorte vazio).

Pistas úteis: à noite um ciclista borrado costuma parecer "pessoa sem pernas visíveis" se deslocando rápido; motos têm farol forte e corpo largo; bicicletas têm quadro fino e rodas finas. Na dúvida entre duas categorias, escolha a mais provável e reduza a confiança.`;

const ESQUEMA = {
  name: "classificacao",
  strict: true,
  schema: {
    type: "object",
    properties: {
      categoria: { type: "string", enum: Object.values(ROTULO_PROMPT) },
      confianca: { type: "number", description: "0 a 1" },
      justificativa: { type: "string", description: "até 20 palavras, em português" },
    },
    required: ["categoria", "confianca", "justificativa"],
    additionalProperties: false,
  },
};

export type ResultadoSugestao = {
  categoria: Sugestao;
  confianca: number;
  justificativa: string;
  modelo: string;
  custo_usd: number | null;
  tokens_entrada: number | null;
};

export type EntradaSugestao = {
  filmstrip: string; // caminho do JPG
  contexto?: string | null;
  dicaDetector?: string | null; // categoria sugerida pelo YOLO, ou null para não enviar
};

function dataUrl(caminho: string): string {
  return `data:image/jpeg;base64,${fs.readFileSync(caminho).toString("base64")}`;
}

export class ErroOpenRouter extends Error {
  readonly status: number | null;
  /** vale tentar de novo (rede, 429, 5xx, resposta malformada) */
  readonly transitorio: boolean;

  constructor(message: string, status: number | null, transitorio: boolean) {
    super(message);
    this.status = status;
    this.transitorio = transitorio;
  }
}

export async function sugerirCategoria(
  entrada: EntradaSugestao,
  opcoes: { modelo?: string; chave?: string; sinal?: AbortSignal } = {},
): Promise<ResultadoSugestao> {
  const chave = opcoes.chave ?? process.env.OPENROUTER_API_KEY;
  if (!chave) throw new ErroOpenRouter("OPENROUTER_API_KEY não configurada (.env na raiz do projeto).", 401, false);
  const modelo = opcoes.modelo ?? process.env.OPENROUTER_MODEL ?? MODELO_PADRAO;

  const conteudo: object[] = [{ type: "text", text: "FILMSTRIP:" }, { type: "image_url", image_url: { url: dataUrl(entrada.filmstrip) } }];
  if (entrada.contexto && fs.existsSync(entrada.contexto)) {
    conteudo.push({ type: "text", text: "CONTEXTO:" }, { type: "image_url", image_url: { url: dataUrl(entrada.contexto) } });
  }
  if (entrada.dicaDetector) {
    const dica = ROTULO_PROMPT[entrada.dicaDetector as Sugestao] ?? entrada.dicaDetector;
    conteudo.push({ type: "text", text: `O detector automático (YOLO, pode errar) sugeriu: ${dica}.` });
  }
  conteudo.push({ type: "text", text: "Classifique o objeto." });

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      cache: "no-store",
      signal: opcoes.sinal ?? AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "X-Title": "Contador de trafego",
      },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        messages: [
          { role: "system", content: INSTRUCOES },
          { role: "user", content: conteudo },
        ],
        response_format: { type: "json_schema", json_schema: ESQUEMA },
      }),
    });
  } catch (e) {
    throw new ErroOpenRouter(`Falha de rede: ${(e as Error).message}`, null, true);
  }

  const corpo = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number; prompt_tokens?: number };
    error?: { message?: string };
    model?: string;
  } | null;
  if (!res.ok || !corpo?.choices?.length) {
    const msg = corpo?.error?.message ?? `HTTP ${res.status}`;
    throw new ErroOpenRouter(`OpenRouter: ${msg}`, res.status, res.status === 429 || res.status >= 500 || res.ok);
  }

  const texto = corpo.choices[0].message?.content ?? "";
  let dados: { categoria?: string; confianca?: number; justificativa?: string };
  try {
    // alguns provedores embrulham o JSON em ```json ... ```
    dados = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ErroOpenRouter(`Resposta não é JSON: ${texto.slice(0, 120)}`, res.status, true);
  }
  const categoria = DO_PROMPT[dados.categoria ?? ""];
  if (!categoria) throw new ErroOpenRouter(`Categoria inválida: ${dados.categoria}`, res.status, true);

  return {
    categoria,
    confianca: Math.min(1, Math.max(0, Number(dados.confianca) || 0)),
    justificativa: String(dados.justificativa ?? "").slice(0, 300),
    modelo: corpo.model ?? modelo,
    custo_usd: corpo.usage?.cost ?? null,
    tokens_entrada: corpo.usage?.prompt_tokens ?? null,
  };
}
