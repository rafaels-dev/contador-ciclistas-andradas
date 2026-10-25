"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { Instalacao, StatusMotor } from "@/lib/motor";
import type { VerificacaoChave } from "@/lib/openrouter";
import { BOTAO, CAMPO } from "@/lib/ui";
import { conferirChaveSalva, escolherPlaca, instalar, progressoInstalacao, salvarChave, verificarMotor, type EstadoConfiguracao } from "./actions";

/**
 * Os três ajustes do app, em linguagem de quem não é da área: placa de vídeo,
 * motor de detecção e chave da inteligência artificial. Usados no primeiro
 * acesso (/boas-vindas) e em Configurações.
 */

function Opcao({ marcada, titulo, texto, aoEscolher, testid }: { marcada: boolean; titulo: string; texto: string; aoEscolher: () => void; testid?: string }) {
  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-pressed={marcada}
      data-testid={testid}
      className={`flex items-start gap-3 rounded-lg border p-3 text-left ${marcada ? "border-accent bg-accent/10" : "border-line bg-raised hover:bg-hover"}`}
    >
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${marcada ? "border-accent" : "border-faint"}`}>
        {marcada && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{titulo}</span>
        <span className="text-sm text-muted">{texto}</span>
      </span>
    </button>
  );
}

export function PainelPlaca({ estado, aoMudar }: { estado: EstadoConfiguracao; aoMudar: (usar: boolean) => void }) {
  const [, iniciar] = useTransition();
  const escolher = (usar: boolean) => {
    aoMudar(usar);
    iniciar(() => escolherPlaca(usar));
  };

  if (estado.placa.tipo === "apple") {
    return <p className="text-sm">Este Mac usa o chip da Apple para acelerar a detecção automaticamente. Não é preciso escolher nada.</p>;
  }
  if (estado.placa.tipo !== "nvidia") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>Não encontramos uma placa de vídeo NVIDIA neste computador.</p>
        <p className="text-muted">
          Tudo funciona mesmo assim, usando o processador — só que a detecção demora bem mais (um vídeo de 1 hora pode levar algumas
          horas). Se você instalar uma placa NVIDIA depois, volte em Configurações.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Placa de vídeo">
      <Opcao
        marcada={estado.usarPlaca}
        titulo={`Usar a placa de vídeo — ${estado.placa.nome}`}
        texto="Recomendado. A detecção fica várias vezes mais rápida."
        aoEscolher={() => escolher(true)}
        testid="usar-placa"
      />
      <Opcao
        marcada={!estado.usarPlaca}
        titulo="Usar só o processador"
        texto="Bem mais lento. Escolha só se a placa de vídeo der problema."
        aoEscolher={() => escolher(false)}
        testid="usar-processador"
      />
    </div>
  );
}

/** Estado do motor + instalação com progresso. `aoFicarPronto` avisa o assistente. */
export function PainelMotor({ estado, aoFicarPronto }: { estado: EstadoConfiguracao; aoFicarPronto?: (pronto: boolean) => void }) {
  const [status, setStatus] = useState<StatusMotor | null>(null);
  const [inst, setInst] = useState<Instalacao | null>(null);
  const [verificando, iniciar] = useTransition();

  const verificar = useCallback(() => {
    iniciar(async () => {
      const s = await verificarMotor();
      setStatus(s);
      aoFicarPronto?.(s.ok);
    });
  }, [aoFicarPronto]);

  // ao abrir: retoma uma instalação em curso, senão confere o motor
  useEffect(() => {
    let vivo = true;
    progressoInstalacao().then((p) => {
      if (!vivo) return;
      if (p.rodando) setInst(p);
      else verificar();
    });
    return () => {
      vivo = false;
    };
  }, [verificar]);

  // acompanha a instalação
  useEffect(() => {
    if (!inst?.rodando) return;
    const t = setInterval(async () => {
      const p = await progressoInstalacao();
      setInst(p);
      if (!p.rodando) {
        clearInterval(t);
        if (p.ok) verificar();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [inst?.rodando, verificar]);

  function comecar() {
    setStatus(null);
    setInst({ rodando: true, ok: null, passo: 1, etapa: "Começando…", linhas: [] });
    void instalar();
  }

  // escolheu usar a placa, mas o motor instalado é o de processador (ou o contrário)
  const placaDivergente =
    status?.ok && estado.placa.tipo === "nvidia" && (estado.usarPlaca ? !status.gpu : false);

  if (inst?.rodando) {
    return (
      <div className="flex flex-col gap-3" data-testid="instalando">
        <p className="font-medium">
          Passo {inst.passo} de 3 — {inst.etapa}…
        </p>
        <span className="barra-indeterminada h-2 rounded-full bg-line" aria-hidden />
        <p className="text-sm text-muted">
          Pode levar de 5 a 20 minutos, dependendo da internet. Deixe o app aberto; você pode continuar os outros passos enquanto isso.
        </p>
        <Detalhes linhas={inst.linhas} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!status || verificando ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="barra-indeterminada h-1.5 w-24 rounded-full bg-line" aria-hidden />
          Verificando o motor de detecção…
        </p>
      ) : status.ok ? (
        <div className="flex flex-col gap-1" data-testid="motor-pronto">
          <p className="font-medium text-ok">✓ Pronto para detectar</p>
          <p className="text-sm text-muted">{status.gpu ? `Usando ${status.gpu}.` : "Usando o processador."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="font-medium">O motor de detecção ainda não está instalado.</p>
          <p className="text-sm text-muted">
            É a parte que reconhece ciclistas, pedestres e veículos nos vídeos. O app baixa e instala tudo sozinho (ocupa cerca de {estado.placa.tipo === "nvidia" && estado.usarPlaca ? "6 GB" : "2 GB"} no disco).
          </p>
        </div>
      )}

      {inst?.ok === false && <p className="text-sm text-danger">{inst.etapa}</p>}
      {placaDivergente && (
        <p className="text-sm text-warn">O motor instalado não está usando a placa de vídeo. Reinstale para aproveitá-la.</p>
      )}

      {status && !verificando && (
        <div className="flex flex-wrap gap-2">
          {estado.podeInstalar && (!status.ok || placaDivergente) && (
            <button type="button" onClick={comecar} className={BOTAO.primario} data-testid="instalar-motor">
              {inst?.ok === false ? "Tentar de novo" : status.ok ? "Reinstalar o motor" : "Instalar agora"}
            </button>
          )}
          {estado.podeInstalar && status.ok && !placaDivergente && (
            <button type="button" onClick={comecar} className={BOTAO.fantasma}>
              Reinstalar o motor
            </button>
          )}
          {!estado.podeInstalar && !status.ok && (
            <p className="text-sm text-muted">Nesta instalação o motor é o Python do sistema: instale as dependências do requirements.txt.</p>
          )}
        </div>
      )}
      {status && !status.ok && <Detalhes linhas={[status.erro ?? `Faltando: ${status.faltando?.join(", ")}`, `Python: ${status.python}`]} />}
      {inst && inst.ok !== null && inst.linhas.length > 0 && <Detalhes linhas={inst.linhas} />}
    </div>
  );
}

function Detalhes({ linhas }: { linhas: string[] }) {
  if (!linhas.length) return null;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer">Detalhes técnicos</summary>
      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-viewer p-2 font-mono text-[0.7rem] text-white/80">
        {linhas.join("\n")}
      </pre>
    </details>
  );
}

const dolar = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "USD" });

export function PainelChave({ temChave, aoFicarPronto }: { temChave: boolean; aoFicarPronto?: (pronto: boolean) => void }) {
  const [salva, setSalva] = useState<VerificacaoChave | null>(null);
  const [chave, setChave] = useState("");
  const [resultado, setResultado] = useState<VerificacaoChave | null>(null);
  const [trocando, setTrocando] = useState(!temChave);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    if (!temChave) return;
    let vivo = true;
    conferirChaveSalva().then((r) => {
      if (!vivo) return;
      setSalva(r);
      aoFicarPronto?.(r.ok);
      if (!r.ok) setTrocando(true);
    });
    return () => {
      vivo = false;
    };
  }, [temChave, aoFicarPronto]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await salvarChave(chave);
      setResultado(r);
      if (r.ok) {
        setSalva(r);
        setChave("");
        setTrocando(false);
        aoFicarPronto?.(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        O app usa uma inteligência artificial para sugerir o que é cada objeto (ciclista, pedestre, carro…) antes de você confirmar. Ela é
        um serviço pago por uso, o <strong>OpenRouter</strong>: cada sugestão custa uma fração de centavo — US$ 5 de crédito dão para dezenas
        de milhares de sugestões.
      </p>

      {salva?.ok && !trocando && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ok/40 bg-ok/10 p-3" data-testid="chave-ok">
          <span className="font-medium text-ok">✓ Chave funcionando</span>
          {salva.saldo_usd != null && <span className="text-sm">Saldo: {dolar(salva.saldo_usd)}</span>}
          {salva.saldo_usd != null && salva.saldo_usd < 1 && <span className="text-sm text-warn">Saldo baixo — adicione créditos no OpenRouter.</span>}
          <span className="flex-1" />
          <button type="button" onClick={() => setTrocando(true)} className={BOTAO.fantasma}>
            Trocar a chave
          </button>
        </div>
      )}
      {temChave && !salva && <p className="text-sm text-muted">Conferindo a chave salva…</p>}

      {trocando && (
        <>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            <li>
              Entre em{" "}
              <a href="https://openrouter.ai/sign-up" target="_blank" rel="noreferrer" className="font-medium text-accent-text underline">
                openrouter.ai
              </a>{" "}
              e crie uma conta (pode entrar com o Google).
            </li>
            <li>
              Em{" "}
              <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer" className="font-medium text-accent-text underline">
                Credits
              </a>
              , adicione créditos com cartão (US$ 5 já é bastante).
            </li>
            <li>
              Em{" "}
              <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="font-medium text-accent-text underline">
                Keys
              </a>
              , clique em <strong>Create Key</strong>, dê um nome (ex.: “Contador”) e copie a chave que aparece — ela começa com{" "}
              <code className="font-mono text-xs">sk-or-</code> e só é mostrada inteira nessa hora (depois a lista mostra só o começo e o fim).
            </li>
            <li>Cole a chave abaixo e clique em “Testar e salvar”.</li>
          </ol>
          <form onSubmit={enviar} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder="Cole aqui a chave (sk-or-…)"
              aria-label="Chave do OpenRouter"
              autoComplete="off"
              className={`${CAMPO} min-w-0 flex-1 font-mono`}
              data-testid="campo-chave"
            />
            <button disabled={!chave.trim() || pendente} className={BOTAO.primario}>
              {pendente ? "Testando…" : "Testar e salvar"}
            </button>
            {salva?.ok && (
              <button type="button" onClick={() => (setTrocando(false), setResultado(null), setChave(""))} className={BOTAO.fantasma}>
                Cancelar
              </button>
            )}
          </form>
          {resultado && !resultado.ok && <p className="text-sm text-danger">{resultado.erro}</p>}
        </>
      )}
      {resultado?.ok && !trocando && <p className="text-sm text-ok">Chave salva.</p>}
    </div>
  );
}
