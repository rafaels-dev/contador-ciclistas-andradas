import { servirArquivo } from "@/lib/arquivos";
import { obterJob } from "@/lib/db";
import { dirJob } from "@/lib/paths";

/** Arquivos de um job (frame0, filmstrips, clipes), com Range. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/arquivos/[...caminho]">) {
  const { id, caminho } = await ctx.params;
  // id precisa ser de um job existente (impede id = ".." apontar para data/)
  if (!/^[\w-]{1,40}$/.test(id) || !obterJob(id)) return new Response("Não encontrado", { status: 404 });
  return servirArquivo(request, dirJob(id), caminho);
}
