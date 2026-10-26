import fs from "node:fs";

/**
 * Sugestão de classificação de um candidato por um modelo de visão via
 * OpenRouter. Sem imports com alias "@/": o script de calibração
 * (web/scripts/calibrar.ts) roda este mesmo código fora do Next.
 */

export const SUGESTOES = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "automoveis", "motocicletas", "outros", "descartado"] as const;
export type Sugestao = (typeof SUGESTOES)[number];

const ROTULO_PROMPT: Record<Sugestao, string> = {
  ciclistas: "ciclista",
  patinetes: "patinete",
  scooters: "scooter_eletrico",
  monociclos: "monociclo",
  pedestres: "pedestre",
  automoveis: "automovel",
  motocicletas: "motocicleta",
  outros: "outro",
  descartado: "nenhum",
};
const DO_PROMPT = Object.fromEntries(Object.entries(ROTULO_PROMPT).map(([k, v]) => [v, k as Sugestao]));

// calibração (out/2026, 142 casos noturnos rotulados): Haiku 5.5 99–100% de
// acerto a ~US$ 0,18/mil; Gemini 3.1 Flash Lite igual a 4×; YOLO sozinho 87%
export const MODELO_PADRAO = "anthropic/claude-haiku-5.5";

/**
 * Reservas, em ordem: o OpenRouter passa para a próxima quando a anterior
 * falha (provedor fora, limite de taxa, "Provider returned error", recusa
 * de moderação) e cobra só a que respondeu. Escolhidas pela calibração —
 * ver CLAUDE.md. OPENROUTER_MODELOS_RESERVA (lista separada por vírgula)
 * troca a lista; vazia ou "nenhum" desliga.
 */
// calibração out/2026 (142 noturnos auditados / 31 diurnos): DeepSeek V4.1 Flash 100%/97% a
// US$ 0,15/mil; Gemini 3.1 Flash Lite 99%/100% a 0,83/mil — provedores diferentes do Haiku
export const RESERVAS_PADRAO = ["deepseek/deepseek-v4.1-flash-1017", "google/gemini-3.1-flash-lite"];

/** Modelo principal + reservas, sem repetição (o principal sempre primeiro). */
export function modelosDaSugestao(opcoes: { modelo?: string; reservas?: string[] } = {}): string[] {
  const principal = opcoes.modelo ?? process.env.OPENROUTER_MODEL ?? MODELO_PADRAO;
  const env = process.env.OPENROUTER_MODELOS_RESERVA;
  const reservas =
    opcoes.reservas ??
    (env === undefined ? RESERVAS_PADRAO : /^\s*(nenhum)?\s*$/i.test(env) ? [] : env.split(",").map((m) => m.trim()).filter(Boolean));
  return [...new Set([principal, ...reservas])];
}

const INSTRUCOES = `Você classifica objetos em movimento vistos por uma câmera fixa de trânsito (rua com ciclovia, calçada e pista de veículos). Pode ser dia ou noite; à noite há borrão de movimento forte e faróis.

Você recebe:
- FILMSTRIP: recortes do MESMO objeto ao longo do tempo (da esquerda para a direita), com uma margem acima do veículo para incluir o condutor.
- CONTEXTO (se houver): o quadro do momento em que o objeto cruza a linha de contagem (linhas amarelas), recortado em volta dele; a caixa colorida marca o objeto. Alguns objetos foram achados só por movimento: a caixa pode cobrir apenas parte dele.

Classifique SOMENTE o objeto marcado: o que aparece em todos os recortes do filmstrip e dentro da caixa do contexto. Outros objetos que passam perto (um ciclista ao lado de um carro, um pedestre atrás de uma moto) têm a sua própria análise — ignore-os, mesmo que chamem mais atenção.

Categorias:
- ciclista: pessoa montada em bicicleta, sentada no selim e pedalando (inclui bicicleta elétrica de pedal).
- patinete: pessoa EM PÉ sobre um patinete, manual ou elétrico (inclusive os de aluguel): plataforma baixa, guidão alto em T, rodas pequenas, sem pedalar; o corpo fica ereto e quase imóvel enquanto desliza.
- scooter_eletrico: pessoa SENTADA num veículo elétrico leve de duas rodas, sem pedalar (motinho/scooter elétrica, "bicicleta elétrica" sem pedal): menor e mais leve que uma moto, rodas pequenas ou finas, sem escapamento.
- monociclo: pessoa EM PÉ sobre um monociclo elétrico (uma única roda entre as pernas, sem guidão; os pés em pedais dos dois lados da roda).
- pedestre: pessoa a pé, andando ou correndo.
- motocicleta: moto, motoneta ou scooter a combustão (com piloto e garupa contam como uma só).
- automovel: carro, van, ônibus, caminhão.
- outro: algo real em movimento que não é nenhuma das categorias acima (animal, carroça, carrinho de mão ou de carga, cadeira de rodas, skate, patins, objeto levado pelo vento etc.) ou que se move de verdade mas não dá para identificar.
- nenhum: não há objeto real em movimento (sombra, reflexo, farol, chuva, árvore balançando, objeto parado, recorte vazio).

Pistas úteis: à noite um ciclista borrado costuma parecer "pessoa sem pernas visíveis" se deslocando rápido; motos têm farol forte e corpo largo; bicicletas têm quadro fino e rodas finas, e o ciclista mexe as pernas; no patinete a pessoa vai em pé, mais alta que um ciclista, e as pernas não giram; no monociclo também vai em pé, mas sem guidão e com os braços soltos. Prefira "outro" a "nenhum" quando houver algo de fato se deslocando. Na dúvida entre duas categorias, escolha a mais provável e reduza a confiança.`;

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

/** Os modelos recusam imagem com lado > 8000 px (Claude) — margem para os outros. */
export const LADO_MAX_IMAGEM = 7900;

/** Largura × altura de um JPEG lendo só o cabeçalho (marcador SOF), sem biblioteca de imagem. */
export function dimensoesJpeg(caminho: string): { largura: number; altura: number } | null {
  let b: Buffer;
  try {
    b = fs.readFileSync(caminho);
  } catch {
    return null;
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function cabeNoModelo(caminho: string): boolean {
  const d = dimensoesJpeg(caminho);
  return !d || (d.largura <= LADO_MAX_IMAGEM && d.altura <= LADO_MAX_IMAGEM);
}

export class ErroOpenRouter extends Error {
  readonly status: number | null;
  /** vale tentar de novo (rede, 429, 5xx, resposta malformada) */
  readonly transitorio: boolean;
  /** o que o OpenRouter/provedor devolveu de fato (p/ diagnóstico; a mensagem é curta) */
  readonly detalhe: string | null;

  constructor(message: string, status: number | null, transitorio: boolean, detalhe: string | null = null) {
    super(message);
    this.status = status;
    this.transitorio = transitorio;
    this.detalhe = detalhe;
  }
}

/** Resume o erro do OpenRouter com o que o provedor respondeu ("Provider returned error" sozinho não diz nada). */
function detalheDoErro(status: number, corpo: unknown, texto: string): string {
  const e = (corpo as { error?: { code?: unknown; message?: unknown; metadata?: { provider_name?: unknown; raw?: unknown } } } | null)?.error;
  const partes = [`HTTP ${status}`];
  if (e?.code != null) partes.push(`código ${String(e.code)}`);
  if (e?.message) partes.push(String(e.message));
  if (e?.metadata?.provider_name) partes.push(`provedor ${String(e.metadata.provider_name)}`);
  if (e?.metadata?.raw != null) partes.push(`resposta: ${typeof e.metadata.raw === "string" ? e.metadata.raw : JSON.stringify(e.metadata.raw)}`);
  if (!e && texto) partes.push(`corpo: ${texto}`);
  return partes.join(" · ").slice(0, 1500);
}

export async function sugerirCategoria(
  entrada: EntradaSugestao,
  /** reservas: [] desliga o fallback (a calibração mede um modelo por vez) */
  opcoes: { modelo?: string; reservas?: string[]; chave?: string; sinal?: AbortSignal } = {},
): Promise<ResultadoSugestao> {
  const chave = opcoes.chave ?? process.env.OPENROUTER_API_KEY;
  if (!chave) throw new ErroOpenRouter("OPENROUTER_API_KEY não configurada (.env na raiz do projeto).", 401, false);
  const modelos = modelosDaSugestao(opcoes);
  const modelo = modelos[0];

  // filmstrip grande demais (gerado antes do limite no worker): vai só o
  // contexto — sem isto o candidato falhava para sempre, mesmo em "Tentar de novo"
  const temContexto = !!entrada.contexto && fs.existsSync(entrada.contexto);
  const conteudo: object[] =
    cabeNoModelo(entrada.filmstrip) || !temContexto
      ? [{ type: "text", text: "FILMSTRIP:" }, { type: "image_url", image_url: { url: dataUrl(entrada.filmstrip) } }]
      : [{ type: "text", text: "(sem FILMSTRIP: o objeto é muito largo e baixo; use só o CONTEXTO)" }];
  if (entrada.contexto && temContexto) {
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
      // com reservas o OpenRouter pode tentar mais de um modelo na mesma chamada
      signal: opcoes.sinal ?? AbortSignal.timeout(modelos.length > 1 ? 120_000 : 60_000),
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "X-Title": "Contador de trafego",
      },
      body: JSON.stringify({
        // `models` = fallback no OpenRouter; a resposta diz em `model` quem respondeu
        ...(modelos.length > 1 ? { models: modelos } : { model: modelo }),
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

  const bruto = await res.text().catch(() => "");
  let corpo: {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number; prompt_tokens?: number };
    error?: { message?: string };
    model?: string;
  } | null = null;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    corpo = null;
  }
  if (!res.ok || !corpo?.choices?.length) {
    const msg = corpo?.error?.message ?? `HTTP ${res.status}`;
    const tentados = modelos.length > 1 ? ` · modelos tentados: ${modelos.join(", ")}` : "";
    throw new ErroOpenRouter(`OpenRouter: ${msg}`, res.status, res.status === 429 || res.status >= 500 || res.ok, detalheDoErro(res.status, corpo, bruto.slice(0, 600)) + tentados);
  }

  const texto = corpo.choices[0].message?.content ?? "";
  let dados: { categoria?: string; confianca?: number; justificativa?: string };
  try {
    // alguns provedores embrulham o JSON em ```json ... ```
    dados = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ErroOpenRouter(`Resposta não é JSON: ${texto.slice(0, 120)}`, res.status, true, `modelo ${corpo.model ?? modelo} · resposta: ${texto.slice(0, 600)}`);
  }
  const categoria = DO_PROMPT[dados.categoria ?? ""];
  if (!categoria) throw new ErroOpenRouter(`Categoria inválida: ${dados.categoria}`, res.status, true, `modelo ${corpo.model ?? modelo} · resposta: ${texto.slice(0, 600)}`);

  return {
    categoria,
    confianca: Math.min(1, Math.max(0, Number(dados.confianca) || 0)),
    justificativa: String(dados.justificativa ?? "").slice(0, 300),
    modelo: corpo.model ?? modelo,
    custo_usd: corpo.usage?.cost ?? null,
    tokens_entrada: corpo.usage?.prompt_tokens ?? null,
  };
}

export type VerificacaoChave = { ok: boolean; saldo_usd: number | null; erro?: string };

/** Confere se a chave funciona e quanto saldo ela tem (para a tela de configuração). */
export async function verificarChave(chave: string): Promise<VerificacaoChave> {
  const cab = { Authorization: `Bearer ${chave}` };
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: cab, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, saldo_usd: null, erro: "Essa chave não foi aceita. Confira se copiou a chave inteira." };
    if (!r.ok) return { ok: false, saldo_usd: null, erro: `O OpenRouter não respondeu direito (erro ${r.status}). Tente de novo.` };
    const c = await fetch("https://openrouter.ai/api/v1/credits", { headers: cab, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const dados = c.ok ? ((await c.json()) as { data?: { total_credits?: number; total_usage?: number } }).data : undefined;
    const saldo = dados?.total_credits != null ? dados.total_credits - (dados.total_usage ?? 0) : null;
    return { ok: true, saldo_usd: saldo };
  } catch {
    return { ok: false, saldo_usd: null, erro: "Sem conexão com o OpenRouter. Confira a internet." };
  }
}
