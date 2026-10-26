import { getJob } from "@/lib/db";
import { frameTimes } from "@/lib/mp4";
import { videoPath } from "@/lib/runner";

/**
 * Time of each frame of the original video, in milliseconds (display order),
 * so the review can match the worker's frame number with the <video> time.
 * null when the format is not MP4/MOV: the review uses frame ÷ fps.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/frames">) {
  const { id } = await ctx.params;
  if (!/^[\w-]{1,40}$/.test(id) || !getJob(id)) return new Response("Not found", { status: 404 });
  const times = frameTimes(videoPath(id));
  return Response.json(times && times.map((t) => Math.round(t * 1000)), { headers: { "Cache-Control": "private, max-age=3600" } });
}
