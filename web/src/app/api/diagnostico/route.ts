import { exigirAcesso } from "@/lib/acesso";
import { gerarDiagnostico } from "@/lib/diagnostico";

/** Relatório de diagnóstico (.zip) para mandar ao suporte — botão em Configurações e nas telas de erro. */
export async function GET() {
  await exigirAcesso(); // além do proxy: o zip traz o log e a configuração
  const { nome, zip } = await gerarDiagnostico();
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
