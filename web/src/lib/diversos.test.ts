import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acessoLiberado } from "./acesso";
import { ehVideo, normalizarCaminho } from "./locais";
import { ETAPAS, etapaAtual, rotuloStatus } from "./status";

describe("normalizarCaminho", () => {
  it("tira as aspas do 'Copiar como caminho' do Windows", () => {
    expect(normalizarCaminho('  "' + path.resolve("videos", "a.mp4") + '"  ')).toBe(path.resolve("videos", "a.mp4"));
  });

  it.runIf(process.platform !== "win32")("no Linux/WSL, C:\\pasta vira /mnt/c/pasta", () => {
    expect(normalizarCaminho("C:\\Users\\Ana\\Vídeos\\cam 4.mp4")).toBe("/mnt/c/Users/Ana/Vídeos/cam 4.mp4");
    expect(normalizarCaminho("D:/dados/x.mp4")).toBe("/mnt/d/dados/x.mp4");
  });

  it.runIf(process.platform === "win32")("no Windows, o caminho fica como está", () => {
    expect(normalizarCaminho("C:\\Users\\Ana\\cam.mp4")).toBe("C:\\Users\\Ana\\cam.mp4");
  });
});

describe("ehVideo", () => {
  it("reconhece as extensões de vídeo, sem diferenciar maiúsculas", () => {
    expect(ehVideo("Andradas_06.MP4")).toBe(true);
    expect(ehVideo("gravação.mkv")).toBe(true);
    expect(ehVideo("foto.jpg")).toBe(false);
    expect(ehVideo("sem-extensao")).toBe(false);
  });
});

describe("status do job", () => {
  it("vídeo do computador não é baixado: só aberto", () => {
    expect(rotuloStatus({ status: "baixando", drive_id: "local" })).toBe("Abrindo o vídeo");
    expect(rotuloStatus({ status: "baixando", drive_id: "abc" })).toBe("Baixando");
  });

  it("cada status cai na etapa certa da barra", () => {
    expect(ETAPAS[etapaAtual("aguardando_linhas")]).toBe("Linhas");
    expect(ETAPAS[etapaAtual("sugerindo")]).toBe("Sugestões");
    expect(ETAPAS[etapaAtual("aguardando_revisao")]).toBe("Revisão");
    expect(ETAPAS[etapaAtual("concluido")]).toBe("Revisão");
    expect(etapaAtual("erro")).toBe(-1);
  });
});

describe("acessoLiberado (servidor do app desktop)", () => {
  const salvo = { ...process.env };
  afterEach(() => {
    process.env = { ...salvo };
  });

  it("sem CONTADOR_TOKEN (next dev), tudo liberado", () => {
    delete process.env.CONTADOR_TOKEN;
    expect(acessoLiberado(undefined, null)).toBe(true);
  });

  it("com token: exige o token certo e o host 127.0.0.1 da porta", () => {
    process.env.CONTADOR_TOKEN = "segredo-123";
    process.env.PORT = "4321";
    expect(acessoLiberado("segredo-123", "127.0.0.1:4321")).toBe(true);
    expect(acessoLiberado("segredo-124", "127.0.0.1:4321")).toBe(false);
    expect(acessoLiberado("segredo", "127.0.0.1:4321")).toBe(false);
    expect(acessoLiberado(undefined, "127.0.0.1:4321")).toBe(false);
    // DNS rebinding: página de outro site apontando para a porta local
    expect(acessoLiberado("segredo-123", "malicioso.example:4321")).toBe(false);
    expect(acessoLiberado("segredo-123", "localhost:4321")).toBe(false);
  });
});
