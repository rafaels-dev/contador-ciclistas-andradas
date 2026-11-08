import fs from "node:fs";
import nodePath from "node:path";
import { getJob, jobDir, jobTempDir } from "@/lib/db";
import { serveFile } from "@/lib/files";

/** A job's files (frame0, filmstrips, clips), with Range: from the temporary folder or the lasting one (lib/db.ts jobFile). */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/files/[...path]">) {
  const { id, path } = await ctx.params;
  // the id must belong to an existing job (stops id = ".." from pointing at data/)
  if (!/^[\w-]{1,40}$/.test(id) || !getJob(id)) return new Response("Not found", { status: 404 });
  // serveFile checks that the path does not leave the chosen folder
  const temp = jobTempDir(id);
  const dir = fs.existsSync(nodePath.join(temp, ...path)) ? temp : jobDir(id);
  return serveFile(request, dir, path);
}
