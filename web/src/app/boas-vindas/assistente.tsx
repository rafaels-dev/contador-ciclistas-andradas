"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BOTAO } from "@/lib/ui";
import { Marca } from "../_shell/barra-titulo";
import { concluirPrimeiroAcesso, conferirChaveSalva, verificarMotor, type EstadoConfiguracao } from "../configuracoes/actions";
import { PainelChave, PainelMotor, PainelPlaca } from "../configuracoes/paineis";

const PASSOS = ["Placa de vídeo", "Motor de detecção", "Inteligência artificial"] as const;

/**
 * Primeiro acesso: prepara o computador em 3 passos, sem termos técnicos.
 * Cobre a tela toda (menos a barra de título, que arrasta a janela).
 */
export function Assistente({ inicial }: { inicial: EstadoConfiguracao }) {
  const [estado, setEstado] = useState(inicial);
  const [passo, setPasso] = useState(0); // 0 = boas-vindas, 1–3 = PASSOS, 4 = pronto
  const [motorPronto, setMotorPronto] = useState<boolean | null>(null);
  const [chavePronta, setChavePronta] = useState<boolean | null>(inicial.temChave ? null : false);
  const [saindo, iniciar] = useTransition();
  const aoMotor = useCallback((ok: boolean) => setMotorPronto(ok), []);
  const aoChave = useCallback((ok: boolean) => setChavePronta(ok), []);

  // pulou algum passo: confere antes do resumo final
  useEffect(() => {
    if (passo !== 4) return;
    if (motorPronto === null) void verificarMotor().then((s) => setMotorPronto(s.ok));
    if (chavePronta === null) void conferirChaveSalva().then((r) => setChavePronta(r.ok));
  }, [passo, motorPronto, chavePronta]);
  const conferindo = passo === 4 && (motorPronto === null || chavePronta === null);

  const pendencias = [
    motorPronto !== true && "o motor de detecção ainda não está pronto — sem ele os vídeos não são analisados",
    chavePronta !== true && "falta a chave da inteligência artificial — sem ela não há sugestões antes da revisão",
  ].filter(Boolean) as string[];

  return (
    <div className="fixed inset-x-0 bottom-0 top-10 z-40 overflow-y-auto bg-app" data-testid="boas-vindas">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-10">
        {passo > 0 && passo < 4 && (
          <ol className="flex items-center gap-2 text-xs" aria-label="Passos">
            {PASSOS.map((nome, i) => (
              <li key={nome} className="flex flex-1 flex-col gap-1.5" aria-current={passo === i + 1 ? "step" : undefined}>
                <span className={`h-1 rounded-full ${i + 1 <= passo ? "bg-accent" : "bg-line"}`} />
                <span className={i + 1 === passo ? "font-semibold text-fg" : "text-faint"}>
                  {i + 1}. {nome}
                </span>
              </li>
            ))}
          </ol>
        )}

        {passo === 0 && (
          <section className="flex flex-1 flex-col justify-center gap-5">
            <Marca className="h-14 w-14" />
            <h1 className="font-display text-3xl font-semibold">Bem-vindo ao Contador de Tráfego</h1>
            <p className="text-muted">
              Você escolhe os vídeos das câmeras e desenha as linhas de contagem. O app encontra tudo o que passa pelas linhas, uma
              inteligência artificial sugere o que é cada um — e você confirma antes de gerar o vídeo final com a contagem.
            </p>
            <p className="text-muted">Antes de começar, vamos preparar este computador. São 3 passos e leva alguns minutos.</p>
            <button type="button" onClick={() => setPasso(1)} className={`${BOTAO.primario} self-start px-5 py-2.5 text-base`}>
              Começar
            </button>
          </section>
        )}

        {passo === 1 && (
          <Passo titulo="Placa de vídeo" texto="A placa de vídeo deixa a análise dos vídeos muito mais rápida.">
            <PainelPlaca estado={estado} aoMudar={(usar) => setEstado((e) => ({ ...e, usarPlaca: usar }))} />
          </Passo>
        )}

        {passo === 2 && (
          <Passo titulo="Motor de detecção" texto="É o programa que reconhece ciclistas, pedestres e veículos nos vídeos.">
            <PainelMotor estado={estado} aoFicarPronto={aoMotor} />
          </Passo>
        )}

        {passo === 3 && (
          <Passo titulo="Inteligência artificial" texto="Sugere o que é cada objeto para você só confirmar.">
            <PainelChave temChave={estado.temChave || chavePronta === true} aoFicarPronto={aoChave} />
          </Passo>
        )}

        {passo === 4 && (
          <section className="flex flex-1 flex-col justify-center gap-4">
            <h1 className="font-display text-3xl font-semibold">{conferindo ? "Conferindo…" : pendencias.length ? "Quase pronto" : "Tudo pronto!"}</h1>
            {conferindo ? null : pendencias.length ? (
              <>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-warn">
                  {pendencias.map((p) => (
                    <li key={p}>{p.charAt(0).toUpperCase() + p.slice(1)}.</li>
                  ))}
                </ul>
                <p className="text-sm text-muted">Você pode terminar isso depois em Configurações (no canto de baixo da barra lateral).</p>
              </>
            ) : (
              <p className="text-muted">Comece importando um vídeo do Google Drive ou do computador.</p>
            )}
            <button type="button" disabled={saindo} onClick={() => iniciar(() => concluirPrimeiroAcesso())} className={`${BOTAO.primario} self-start px-5 py-2.5 text-base`}>
              Abrir o app
            </button>
          </section>
        )}

        {passo > 0 && passo < 4 && (
          <nav className="mt-auto flex items-center gap-3 border-t border-line pt-4">
            <button type="button" onClick={() => setPasso(passo - 1)} className={BOTAO.fantasma}>
              Voltar
            </button>
            <span className="flex-1" />
            {passo === 2 && motorPronto !== true && <span className="text-xs text-muted">Dá para seguir enquanto instala</span>}
            <button
              type="button"
              onClick={() => setPasso(passo + 1)}
              className={(passo === 2 && motorPronto !== true) || (passo === 3 && chavePronta !== true) ? BOTAO.secundario : BOTAO.primario}
              data-testid="proximo"
            >
              {(passo === 3 && chavePronta !== true) ? "Fazer depois" : "Próximo"}
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

function Passo({ titulo, texto, children }: { titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{titulo}</h1>
        <p className="text-muted">{texto}</p>
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">{children}</div>
    </section>
  );
}
