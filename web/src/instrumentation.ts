/** Na abertura do servidor: corrige motores instalados por versões antigas (ver ajustarMotor). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ajustarMotor } = await import("./lib/motor");
  void ajustarMotor();
}
