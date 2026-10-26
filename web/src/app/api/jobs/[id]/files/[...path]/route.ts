import { getJob } from "@/lib/db";
import { serveFile } from "@/lib/files";
import { jobDir } from "@/lib/paths";

/** A job's files (frame0, filmstrips, clips), with Range. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/files/[...path]">) {
  const { id, path } = await ctx.params;
  // the id must belong to an existing job (stops id = ".." from pointing at data/)
  if (!/^[\w-]{1,40}$/.test(id) || !getJob(id)) return new Response("Not found", { status: 404 });
  return serveFile(request, jobDir(id), path);
}
