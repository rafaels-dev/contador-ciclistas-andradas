import { requireAccess } from "@/lib/access";
import { buildDiagnostics } from "@/lib/diagnostics";

/** Diagnostics report (.zip) to send to support — button in Settings and on the error screens. */
export async function GET() {
  await requireAccess(); // beyond the proxy: the zip carries the log and the configuration
  const { name, zip } = await buildDiagnostics();
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
