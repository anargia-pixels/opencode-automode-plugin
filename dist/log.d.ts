export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFn = (level: LogLevel, message: string, extra?: Record<string, unknown>) => void;
/**
 * Log through the console and, when `logFile` is set, append one JSON line per
 * entry. opencode does not forward plugin console output to its log, so the
 * file is the reliable record of guard decisions.
 */
export declare function createLog(prefix: string, logFile?: string | undefined): LogFn;
