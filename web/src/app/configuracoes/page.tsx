import { connection } from "next/server";
import { Suspense } from "react";
import { ARQUIVO_ENV } from "@/lib/env";
import { estadoInstalacao, pastaMotor, statusMotor } from "@/lib/motor";
import { MODELO_PADRAO } from "@/lib/openrouter";
import { DIR_DADOS } from "@/lib/paths";
import { BOTAO, CAMPO, TITULO_PAINEL } from "@/lib/ui";
import { AutoRefresh } from "../jobs/[id]/auto-refresh";
import { instalar, salvarChave } from "./actions";

export default function PaginaConfiguracoes() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
      <h1 className="font-display text-2xl font-semibold">Configurações</h1>
      <Suspense fallback={<Secao titulo="Motor de detecção"><p className="text-sm text-muted">Verificando o Python…</p></Secao>}>
        <Motor />
      </Suspense>
      <Suspense fallback={null}>
        <ModeloVisao />
      </Suspense>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h2 className={TITULO_PAINEL}>{titulo}</h2>
      {children}
    </section>
  );
}

function Item({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
      <dt className="text-muted">{nome}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

async function Motor() {
  await connection();
  const inst = estadoInstalacao();
  const s = inst.rodando ? null : await statusMotor();
  const podeInstalar = !!pastaMotor();
  return (
    <Secao titulo="Motor de detecção">
      {inst.rodando && <AutoRefresh ms={2000} />}
      <p className="text-sm text-muted">
        O Python com YOLO e OpenCV que detecta os objetos e gera o vídeo final. Placa de vídeo NVIDIA é opcional — sem ela, a detecção
        roda no processador (bem mais devagar).
      </p>
      {s && (
        <dl className="flex flex-col gap-1.5">
          <Item nome="Situação">
            {s.ok ? <span className="font-medium text-ok">Pronto</span> : <span className="font-medium text-danger">{s.erro ?? `Faltam: ${s.faltando?.join(", ")}`}</span>}
          </Item>
          {s.versao && <Item nome="Python">{s.versao}</Item>}
          <Item nome="Placa de vídeo">{s.gpu ?? (s.ok ? "nenhuma — usando o processador" : "—")}</Item>
          <Item nome="Executável">
            <code className="font-mono text-xs text-muted">{s.python}</code>
          </Item>
        </dl>
      )}
      {podeInstalar ? (
        <div className="flex flex-col gap-2">
          <form action={instalar}>
            <button disabled={inst.rodando} className={s && !s.ok ? BOTAO.primario : BOTAO.secundario}>
              {inst.rodando ? "Instalando…" : s?.ok ? "Reinstalar / atualizar o motor" : "Instalar o motor (~3 GB)"}
            </button>
          </form>
          {inst.linhas.length > 0 && (
            <pre className="max-h-64 overflow-y-auto rounded-md border border-line bg-viewer p-3 font-mono text-[0.7rem] leading-relaxed text-white/80" data-testid="log-instalacao">
              {inst.linhas.slice(-80).join("\n")}
            </pre>
          )}
        </div>
      ) : (
        !s?.ok && <p className="text-sm text-muted">No modo de desenvolvimento, instale com <code className="font-mono text-xs">pip install -r requirements.txt</code>.</p>
      )}
    </Secao>
  );
}

async function ModeloVisao() {
  await connection();
  const temChave = !!process.env.OPENROUTER_API_KEY;
  const editavel = !!process.env.CONTADOR_ENV;
  return (
    <Secao titulo="Modelo de visão (OpenRouter)">
      <p className="text-sm text-muted">Sugere a classe de cada objeto antes da sua revisão. Precisa de uma chave do openrouter.ai.</p>
      <dl className="flex flex-col gap-1.5">
        <Item nome="Chave">{temChave ? <span className="font-medium text-ok">Configurada</span> : <span className="font-medium text-danger">Não configurada</span>}</Item>
        <Item nome="Modelo">
          <code className="font-mono text-xs">{process.env.OPENROUTER_MODEL ?? MODELO_PADRAO}</code>
        </Item>
      </dl>
      {editavel ? (
        <form action={salvarChave} className="flex gap-2">
          <input name="chave" type="password" required autoComplete="off" placeholder={temChave ? "Trocar a chave…" : "sk-or-…"} aria-label="Chave do OpenRouter" className={`${CAMPO} min-w-0 flex-1 font-mono`} />
          <button className={BOTAO.secundario}>Salvar</button>
        </form>
      ) : (
        <p className="text-sm text-muted">
          Definida em <code className="font-mono text-xs">{ARQUIVO_ENV}</code>.
        </p>
      )}
      <p className="text-xs text-faint">
        Dados do app: <code className="font-mono">{DIR_DADOS}</code>
      </p>
    </Secao>
  );
}
