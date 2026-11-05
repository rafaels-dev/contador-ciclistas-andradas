/**
 * Environment variables renamed when the code moved to English (0.0.8). The
 * old names keep working: in the shell, in a developer's scripts and in the
 * config files written by older versions (`config.env`, the root `.env`).
 */
export const LEGACY_ENV: Record<string, string> = {
  CONTADOR_DADOS: "TRAFFIC_COUNTER_DATA",
  CONTADOR_ENV: "TRAFFIC_COUNTER_ENV",
  CONTADOR_LOG: "TRAFFIC_COUNTER_LOG",
  CONTADOR_MOTOR: "TRAFFIC_COUNTER_ENGINE",
  CONTADOR_RAIZ: "TRAFFIC_COUNTER_ROOT",
  CONTADOR_TOKEN: "TRAFFIC_COUNTER_TOKEN",
  CONTADOR_UV: "TRAFFIC_COUNTER_UV",
  CONTADOR_VERSAO: "TRAFFIC_COUNTER_VERSION",
  CONTADOR_FIM_S: "TRAFFIC_COUNTER_END_S",
  CONTADOR_ARQUIVOS_LOCAIS: "TRAFFIC_COUNTER_LOCAL_FILES",
  CONTADOR_FFMPEG: "TRAFFIC_COUNTER_FFMPEG",
  CONTADOR_SEM_NVDEC: "TRAFFIC_COUNTER_NO_NVDEC",
  CONTADOR_DESKTOP_URL: "TRAFFIC_COUNTER_DESKTOP_URL",
  OPENROUTER_CONCORRENCIA: "OPENROUTER_CONCURRENCY",
  OPENROUTER_DICA_YOLO: "OPENROUTER_YOLO_HINT",
  OPENROUTER_MODELOS_RESERVA: "OPENROUTER_FALLBACK_MODELS",
  PESOS_BICICLETAS_URL: "BICYCLE_WEIGHTS_URL",
};

/** Copies each old variable to its new name, unless the new one is already set. */
export function adoptLegacyEnv(env: Record<string, string | undefined> = process.env): void {
  for (const [old, name] of Object.entries(LEGACY_ENV)) {
    if (env[name] === undefined && env[old] !== undefined) env[name] = env[old];
  }
}

adoptLegacyEnv();
