import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { ARQUIVO_ENV } from "./env";
import { listarCandidatosComErro, listarJobs, listarRenders, resumoCandidatos, resumoSugestoes } from "./db";
import { detectarPlaca, estadoInstalacao, pastaMotor, pythonDoMotor, statusMotor, usarPlaca } from "./motor";
import { modelosDaSugestao } from "./openrouter";
import { DIR_DADOS, RAIZ_REPO, dirJob } from "./paths";

/**
 * Relatório de diagnóstico: um .zip que o usuário salva e manda para quem dá
 * suporte quando algo dá errado. Reúne o registro do servidor, a
 * configuração (sem a chave da IA), o estado do motor, os jobs e renders com
 * seus erros e, para cada sugestão que falhou, o que o OpenRouter respondeu
 * e as imagens enviadas. Nada de vídeo nem de chave.
 */

/** Registro do servidor: o Electron grava em CONTADOR_LOG (userData/servidor.log). */
export const ARQUIVO_LOG = process.env.CONTADOR_LOG ?? path.join(DIR_DADOS, "..", "servidor.log");

const LOG_MAX = 3 * 1024 * 1024; // só o fim do log, se for grande
const IMAGENS_MAX = 60; // filmstrips/contextos das falhas

type Entrada = { nome: string; dados: Buffer };

/** ZIP sem compressão (os JPGs já são comprimidos; o log é pequeno) — evita uma dependência só para isto. */
function zipar(entradas: Entrada[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const agora = new Date();
  const horaDos = ((agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1)) & 0xffff;
  const dataDos = (((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate()) & 0xffff;
  for (const { nome, dados } of entradas) {
    const n = Buffer.from(nome, "utf8");
    const crc = zlib.crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(0, 8); // sem compressão
    local.writeUInt16LE(horaDos, 10);
    local.writeUInt16LE(dataDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(horaDos, 12);
    cd.writeUInt16LE(dataDos, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dados.length, 20);
    cd.writeUInt32LE(dados.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    partes.push(local, n, dados);
    central.push(cd, n);
    offset += local.length + n.length + dados.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamCentral, 12);
  fim.writeUInt32LE(offset, 16);
  fim.writeUInt16LE(0, 20);
  return Buffer.concat([...partes, ...central, fim]);
}

function lerFim(arquivo: string, max: number): string | null {
  try {
    const st = fs.statSync(arquivo);
    const fd = fs.openSync(arquivo, "r");
    try {
      const tam = Math.min(st.size, max);
      const buf = Buffer.alloc(tam);
      fs.readSync(fd, buf, 0, tam, st.size - tam);
      return (st.size > max ? `[… ${st.size - max} bytes anteriores omitidos …]\n` : "") + buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** config.env sem o valor de chaves/segredos. */
function configuracaoMascarada(): string | null {
  try {
    return fs
      .readFileSync(ARQUIVO_ENV, "utf8")
      .split(/\r?\n/)
      .map((l) => (/^\s*(export\s+)?[A-Z0-9_]*(KEY|TOKEN|SECRET|SENHA|PASSWORD)[A-Z0-9_]*\s*=/i.test(l) ? l.replace(/=.*$/, "=<omitida>") : l))
      .join("\n");
  } catch {
    return null;
  }
}

function existe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export async function gerarDiagnostico(): Promise<{ nome: string; zip: Buffer }> {
  const entradas: Entrada[] = [];
  const texto = (nome: string, conteudo: string) => entradas.push({ nome, dados: Buffer.from(conteudo, "utf8") });
  const json = (nome: string, valor: unknown) => texto(nome, JSON.stringify(valor, null, 1));

  const motor = await statusMotor().catch((e) => ({ python: pythonDoMotor(), ok: false, erro: String(e) }));
  const placa = detectarPlaca();
  const resumo = {
    gerado_em: new Date().toISOString(),
    app: { versao: process.env.CONTADOR_VERSAO ?? "(dev)", desktop: !!process.env.CONTADOR_TOKEN, node: process.version },
    sistema: { plataforma: process.platform, versao: os.release(), arquitetura: process.arch, cpus: os.cpus().length, memoria_gb: Math.round(os.totalmem() / 2 ** 30), locale: Intl.DateTimeFormat().resolvedOptions().locale },
    placa: { detectada: placa, usar: usarPlaca() },
    motor: { ...motor, pasta: pastaMotor(), instalacao: estadoInstalacao() },
    ia: { chave_configurada: !!process.env.OPENROUTER_API_KEY, modelos: modelosDaSugestao() },
    pastas: { dados: DIR_DADOS, raiz: RAIZ_REPO, config: ARQUIVO_ENV, log: ARQUIVO_LOG, pesos_bicicletas: existe(path.join(RAIZ_REPO, "runs", "ft_blur", "weights", "best.pt")) },
  };
  json("resumo.json", resumo);

  const log = lerFim(ARQUIVO_LOG, LOG_MAX);
  if (log != null) texto("servidor.log", log);
  const config = configuracaoMascarada();
  if (config != null) texto("config.env", config);

  const jobs = listarJobs();
  json(
    "jobs.json",
    jobs.map((j) => {
      const d = dirJob(j.id);
      return {
        ...j,
        linhas: JSON.parse(j.linhas),
        sugestoes: resumoSugestoes(j.id),
        candidatos: resumoCandidatos(j.id),
        arquivos: existe(d) ? fs.readdirSync(d).filter((a) => !a.startsWith(".")) : [],
      };
    }),
  );
  json("renders.json", listarRenders());

  for (const j of jobs) {
    for (const nome of ["sugestoes_erros.jsonl", "info.json", "candidatos.json"]) {
      const arq = path.join(dirJob(j.id), nome);
      if (nome === "candidatos.json" && !existe(path.join(dirJob(j.id), "sugestoes_erros.jsonl"))) continue;
      const conteudo = lerFim(arq, 1024 * 1024);
      if (conteudo != null) texto(`jobs/${j.id}/${nome}`, conteudo);
    }
  }

  const falhas = listarCandidatosComErro();
  json("sugestoes_falhas.json", falhas);
  let imagens = 0;
  for (const c of falhas) {
    if (imagens >= IMAGENS_MAX) break;
    for (const rel of [c.filmstrip, c.contexto]) {
      if (!rel) continue;
      try {
        entradas.push({ nome: `jobs/${c.job_id}/${rel.replaceAll("\\", "/")}`, dados: fs.readFileSync(path.join(dirJob(c.job_id), rel)) });
        imagens++;
      } catch {}
    }
  }

  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return { nome: `diagnostico-contador-${carimbo}.zip`, zip: zipar(entradas) };
}
