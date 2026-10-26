import { connection } from "next/server";
import { Suspense } from "react";
import { ARQUIVO_LOG } from "@/lib/diagnostico";
import { ARQUIVO_ENV } from "@/lib/env";
import { detectarPlaca, pastaMotor, pythonDoMotor, usarPlaca } from "@/lib/motor";
import { modelosDaSugestao } from "@/lib/openrouter";
import { DIR_DADOS } from "@/lib/paths";
import { BOTAO, TITULO_PAINEL } from "@/lib/ui";
import { refazerPrimeiroAcesso } from "./actions";
import { Paineis } from "./paineis-pagina";

export default function PaginaConfiguracoes() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5">
      <h1 className="font-display text-2xl font-semibold">Configurações</h1>
      <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
        <Conteudo />
      </Suspense>
    </div>
  );
}

async function Conteudo() {
  await connection();
  return (
    <>
      <Paineis inicial={{ placa: detectarPlaca(), usarPlaca: usarPlaca(), podeInstalar: !!pastaMotor(), temChave: !!process.env.OPENROUTER_API_KEY }} />
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
        <h2 className={TITULO_PAINEL}>Ajuda e diagnóstico</h2>
        <p className="text-sm">
          Se algo der errado, salve o relatório de diagnóstico e envie o arquivo para quem dá suporte ao app. Ele reúne o registro do
          programa, as configurações e o que aconteceu em cada vídeo — sem os vídeos e sem a sua chave da inteligência artificial.
        </p>
        <div>
          <a href="/api/diagnostico" className={BOTAO.secundario} data-testid="salvar-diagnostico">
            Salvar relatório de diagnóstico
          </a>
        </div>
      </section>
      <details className="rounded-lg border border-line bg-panel p-4 text-sm">
        <summary className={`${TITULO_PAINEL} cursor-pointer`}>Detalhes técnicos</summary>
        <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted">Versão do app</dt>
          <dd className="font-mono">{process.env.CONTADOR_VERSAO ?? "desenvolvimento"}</dd>
          <dt className="text-muted">Modelos de visão</dt>
          <dd className="font-mono" title="O primeiro é o principal; os outros entram se ele falhar (OPENROUTER_MODEL e OPENROUTER_MODELOS_RESERVA no arquivo de configuração)">
            {modelosDaSugestao().join(" → ")}
          </dd>
          <dt className="text-muted">Registro (log)</dt>
          <dd className="break-all font-mono">{ARQUIVO_LOG}</dd>
          <dt className="text-muted">Dados do app</dt>
          <dd className="break-all font-mono">{DIR_DADOS}</dd>
          <dt className="text-muted">Configuração</dt>
          <dd className="break-all font-mono">{ARQUIVO_ENV}</dd>
          <dt className="text-muted">Python do motor</dt>
          <dd className="break-all font-mono">{pythonDoMotor()}</dd>
        </dl>
        <form action={refazerPrimeiroAcesso} className="mt-4">
          <button className={BOTAO.secundario}>Abrir o assistente de primeiro acesso de novo</button>
        </form>
      </details>
    </>
  );
}
