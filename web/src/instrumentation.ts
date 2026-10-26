/** On server start: fixes engines installed by older versions (see adjustEngine). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { adjustEngine } = await import("./lib/engine");
  void adjustEngine();
}
