import type { PluginOptions } from "@opencode/plugin";

// Types

export interface AutomodeConfig {
  /** opencode provider that serves the classifier model. */
  readonly providerID: string;
  /** Classifier model id within the provider. */
  readonly modelID: string;
  /** Model variant, such as a reasoning effort. `undefined` uses the model default. */
  readonly variant: string | undefined;
  readonly timeoutMs: number;
  /**
   * When the classifier fails after a retry, leave the permission ask to
   * opencode (`true`), or deny the command (`false`, the default). In auto
   * mode a left ask is approved by the client, so only interactive users
   * should turn this on. The plugin itself never approves without a verdict.
   */
  readonly failOpen: boolean;
  /** Refuse to read known secret files such as `.env` and private keys. */
  readonly protectSecretFiles: boolean;
  /** Add the auto mode note to the system prompt so a denial leads to a safer route. */
  readonly continueOnDeny: boolean;
  /** Consecutive blocks in one session before the model is told to stop and ask the user. */
  readonly maxConsecutiveDenials: number;
  readonly cacheTtlMs: number;
  readonly maxCacheEntries: number;
  /** File that receives one JSON line per guard decision. */
  readonly logFile: string | undefined;
}

export interface ParsedConfig {
  readonly config: AutomodeConfig;
  readonly warnings: readonly string[];
}

// Global constants

/** DeepSeek V4.1 Flash from the OpenCode Go subscription, at low reasoning for speed. */
export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
export const DEFAULT_VARIANT = "low";

export const DEFAULT_CONFIG = {
  timeoutMs: 20_000,
  failOpen: false,
  protectSecretFiles: true,
  continueOnDeny: true,
  maxConsecutiveDenials: 3,
  cacheTtlMs: 10 * 60_000,
  maxCacheEntries: 500,
} as const;

// Parse

/**
 * Read plugin options into a validated config.
 *
 * Invalid values fall back to the default and produce a warning instead of an
 * error, so a typo in the config cannot stop opencode from starting.
 */
export function parseConfig(options: PluginOptions | undefined = undefined): ParsedConfig {
  const source: Record<string, unknown> = options ?? {};
  const warnings: string[] = [];

  return {
    config: {
      ...readModel(source, warnings),
      variant: readVariant(source, warnings),
      timeoutMs: readNumber(source, "timeoutMs", DEFAULT_CONFIG.timeoutMs, 1000, 120_000, warnings),
      failOpen: readBoolean(source, "failOpen", DEFAULT_CONFIG.failOpen, warnings),
      protectSecretFiles: readBoolean(source, "protectSecretFiles", DEFAULT_CONFIG.protectSecretFiles, warnings),
      continueOnDeny: readBoolean(source, "continueOnDeny", DEFAULT_CONFIG.continueOnDeny, warnings),
      maxConsecutiveDenials: readNumber(source, "maxConsecutiveDenials", DEFAULT_CONFIG.maxConsecutiveDenials, 1, 100, warnings),
      cacheTtlMs: readNumber(source, "cacheTtlMs", DEFAULT_CONFIG.cacheTtlMs, 0, 24 * 60 * 60_000, warnings),
      maxCacheEntries: readNumber(source, "maxCacheEntries", DEFAULT_CONFIG.maxCacheEntries, 0, 10_000, warnings),
      logFile: readLogFile(source, warnings),
    },
    warnings,
  };
}

// Readers

interface ModelRef {
  readonly providerID: string;
  readonly modelID: string;
}

/** Read `model` as `provider/model`, or the default when it is absent or invalid. */
function readModel(source: Record<string, unknown>, warnings: string[]): ModelRef {
  const value = source.model ?? DEFAULT_MODEL;
  const model = typeof value === "string" ? splitModel(value.trim()) : undefined;
  if (model !== undefined) return model;
  warnings.push(`model must look like "provider/model"; using ${DEFAULT_MODEL}`);
  return splitModel(DEFAULT_MODEL)!;
}

/** Split `provider/model`, or `undefined` when either side is empty. */
function splitModel(text: string): ModelRef | undefined {
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) return undefined;
  return { providerID: text.slice(0, slash), modelID: text.slice(slash + 1) };
}

/** Read the model variant. An empty string turns it off and uses the model default. */
function readVariant(source: Record<string, unknown>, warnings: string[]): string | undefined {
  const value = source.variant;
  if (value === undefined) return DEFAULT_VARIANT;
  if (typeof value !== "string") {
    warnings.push(`variant must be a string; using ${DEFAULT_VARIANT}`);
    return DEFAULT_VARIANT;
  }
  return value.trim() === "" ? undefined : value.trim();
}

/** Read the optional log file path. */
function readLogFile(source: Record<string, unknown>, warnings: string[]): string | undefined {
  const value = source.logFile;
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  warnings.push("logFile must be a non-empty path; logging to the console only");
  return undefined;
}

/** Read a finite number option and clamp it to `[min, max]`. */
function readNumber(source: Record<string, unknown>, key: string, fallback: number, min: number, max: number, warnings: string[]): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    warnings.push(`${key} must be a number; using ${fallback}`);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  if (clamped !== value) warnings.push(`${key} is outside [${min}, ${max}]; using ${clamped}`);
  return clamped;
}

/** Read a boolean option, or the fallback when it is absent or invalid. */
function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean, warnings: string[]): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    warnings.push(`${key} must be true or false; using ${fallback}`);
    return fallback;
  }
  return value;
}
