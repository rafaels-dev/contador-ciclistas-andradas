import { servirArquivo } from "@/lib/arquivos";
import { obterRender } from "@/lib/db";
import { dirRender } from "@/lib/paths";

/** Vídeo final, relatório e CSV de um render, com Range. */
export async function GET(request: Request, ctx: RouteContext<"/api/renders/[id]/arquivos/[...caminho]">) {
  const { id, caminho } = await ctx.params;
  if (!/^[\w-]{1,40}$/.test(id) || !obterRender(id)) return new Response("Não encontrado", { status: 404 });
  return servirArquivo(request, dirRender(id), caminho);
}
