import { timingSafeEqual } from "node:crypto";

/**
 * Acesso ao servidor embutido no app desktop. Ele escuta em 127.0.0.1, mas
 * isso não basta: outro programa do computador, ou uma página aberta no
 * navegador por DNS rebinding, alcançaria a porta. O Electron sorteia um
 * token a cada execução (CONTADOR_TOKEN) e o entrega só à sua janela, como
 * cookie; o servidor também recusa Host diferente de 127.0.0.1:<porta>.
 * Sem CONTADOR_TOKEN (next dev), nada muda.
 */

export const COOKIE_TOKEN = "contador_token";

export function acessoLiberado(token: string | undefined, host: string | null): boolean {
  const esperado = process.env.CONTADOR_TOKEN;
  if (!esperado) return true;
  if (host !== `127.0.0.1:${process.env.PORT}`) return false;
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Para server actions que mexem em configuração ou no disco (defesa além do proxy). */
export async function exigirAcesso(): Promise<void> {
  const { cookies, headers } = await import("next/headers");
  const [c, h] = await Promise.all([cookies(), headers()]);
  if (!acessoLiberado(c.get(COOKIE_TOKEN)?.value, h.get("host"))) throw new Error("Acesso negado.");
}
