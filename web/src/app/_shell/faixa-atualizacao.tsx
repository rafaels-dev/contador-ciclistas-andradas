"use client";

import { useEffect, useState } from "react";
import { BOTAO } from "@/lib/ui";

/**
 * "Versão X pronta — Reiniciar e atualizar". A versão nova é baixada em
 * segundo plano e também é instalada ao fechar o app; a faixa existe para
 * quem deixa o app aberto e não sabia disso. "Depois" esconde até a próxima
 * abertura. Fora do app desktop (navegador), não aparece.
 */
export function FaixaAtualizacao({ ocupadas }: { ocupadas: number }) {
  const [estado, setEstado] = useState<EstadoAtualizacao | null>(null);
  const [depois, setDepois] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);

  useEffect(() => {
    const ponte = window.contadorDesktop?.atualizacao;
    if (!ponte) return;
    let vivo = true;
    ponte.estado().then((e) => vivo && setEstado(e));
    const parar = ponte.aoMudar((e) => setEstado(e));
    return () => {
      vivo = false;
      parar();
    };
  }, []);

  if (!estado || estado.fase !== "pronta" || depois) return null;
  const versao = estado.versao ? `A versão ${estado.versao}` : "Uma versão nova";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm" role="status" data-testid="faixa-atualizacao">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{versao} do Contador de Tráfego está pronta.</strong>{" "}
        {ocupadas > 0 ? (
          <span className="text-warn">
            Há {ocupadas === 1 ? "uma tarefa rodando" : `${ocupadas} tarefas rodando`} — reiniciar agora interrompe {ocupadas === 1 ? "ela" : "todas"}. Se preferir, espere
            terminar: ao fechar o app, a atualização é instalada.
          </span>
        ) : (
          <span className="text-muted">O instalador mostra o progresso e o app abre de novo sozinho em cerca de um minuto.</span>
        )}
      </span>
      <button
        type="button"
        disabled={reiniciando}
        onClick={() => {
          setReiniciando(true);
          window.contadorDesktop?.atualizacao?.instalar();
        }}
        className={ocupadas > 0 ? BOTAO.secundario : BOTAO.primario}
        data-testid="reiniciar-atualizar"
      >
        {reiniciando ? "Reiniciando…" : ocupadas > 0 ? "Interromper e atualizar" : "Reiniciar e atualizar"}
      </button>
      <button type="button" onClick={() => setDepois(true)} className={BOTAO.fantasma}>
        Depois
      </button>
    </div>
  );
}
