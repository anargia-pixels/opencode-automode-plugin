import { appendFileSync } from "node:fs";

// Types

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFn = (level: LogLevel, message: string, extra?: Record<string, unknown>) => void;

// Logger

/**
 * Log through the console and, when `logFile` is set, append one JSON line per
 * entry. opencode does not forward plugin console output to its log, so the
 * file is the reliable record of guard decisions.
 */
export function createLog(prefix: string, logFile: string | undefined = undefined): LogFn {
  return (level, message, extra) => {
    const head = `${prefix} ${level}: ${message}`;
    const text = extra === undefined ? head : `${head} ${JSON.stringify(extra)}`;
    if (level === "error") console.error(text);
    else console.log(text);
    if (logFile === undefined) return;
    try {
      appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), level, message, ...extra })}\n`, "utf8");
    } catch {
      // Logging must never break a permission decision.
    }
  };
}
