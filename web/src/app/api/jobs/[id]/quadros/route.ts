import { obterJob } from "@/lib/db";
import { temposDosQuadros } from "@/lib/mp4";
import { caminhoVideo } from "@/lib/runner";

/**
 * Tempo de cada quadro do vídeo original, em milissegundos (ordem de exibição),
 * para a revisão casar o número do quadro do worker com o tempo do <video>.
 * null quando o formato não é MP4/MOV: a revisão usa quadro ÷ fps.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/quadros">) {
  const { id } = await ctx.params;
  if (!/^[\w-]{1,40}$/.test(id) || !obterJob(id)) return new Response("Não encontrado", { status: 404 });
  const tempos = temposDosQuadros(caminhoVideo(id));
  return Response.json(tempos && tempos.map((t) => Math.round(t * 1000)), { headers: { "Cache-Control": "private, max-age=3600" } });
}
