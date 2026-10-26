import { servirVideo } from "@/lib/arquivos";
import { obterJob } from "@/lib/db";
import { caminhoVideo } from "@/lib/runner";

/** O vídeo original do job, com Range, para navegar quadro a quadro na revisão. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/video">) {
  const { id } = await ctx.params;
  if (!/^[\w-]{1,40}$/.test(id) || !obterJob(id)) return new Response("Não encontrado", { status: 404 });
  return servirVideo(request, caminhoVideo(id));
}
