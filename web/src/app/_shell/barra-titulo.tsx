import Link from "next/link";
import { BotaoTema } from "./botao-tema";

/**
 * Barra de título do app. No desktop (Electron, janela sem moldura) ela é a
 * região de arrastar a janela e abre espaço para os botões do sistema:
 * semáforo à esquerda no macOS, minimizar/fechar à direita no Windows/Linux.
 */
export function BarraTitulo() {
  return (
    <header className="regiao-arrasto flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 barra-titulo">
      <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-0.5">
        <Marca />
        <span className="font-display text-[0.95rem] font-semibold tracking-wide">Contador de tráfego</span>
      </Link>
      <span className="flex-1" />
      <BotaoTema />
    </header>
  );
}

/** Uma linha de contagem amarela cortando a faixa — o gesto central do app. */
export function Marca({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5" className="fill-raised stroke-line" strokeWidth="1.5" />
      <path d="M5 16.5h14M5 7.5h14" className="stroke-faint" strokeWidth="1.5" strokeDasharray="2.5 2" />
      <path d="M15.5 3.5 8.5 20.5" className="stroke-accent" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
