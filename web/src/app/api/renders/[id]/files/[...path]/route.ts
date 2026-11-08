import { getRender } from "@/lib/db";
import { serveFile } from "@/lib/files";
import { renderDir } from "@/lib/db";

/** A render's final video, report and CSV, with Range. */
export async function GET(request: Request, ctx: RouteContext<"/api/renders/[id]/files/[...path]">) {
  const { id, path } = await ctx.params;
  if (!/^[\w-]{1,40}$/.test(id) || !getRender(id)) return new Response("Not found", { status: 404 });
  return serveFile(request, renderDir(id), path);
}
