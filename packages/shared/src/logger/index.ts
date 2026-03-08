import pino from "pino";

export function createLogger(name: string, level?: string) {
  return pino({
    name,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}
