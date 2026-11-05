import { getJob } from "@/lib/db";
import { serveVideo } from "@/lib/files";
import { videoPath } from "@/lib/runner";

/** The job's original video, with Range, to step frame by frame in the review. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/video">) {
  const { id } = await ctx.params;
  if (!/^[\w-]{1,40}$/.test(id) || !getJob(id)) return new Response("Not found", { status: 404 });
  return serveVideo(request, videoPath(id));
}
