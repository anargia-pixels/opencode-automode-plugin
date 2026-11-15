import type { PluginOptions } from "@opencode/plugin";

// Types

/** A model in opencode, from any provider, with an optional variant such as a reasoning effort. */
export interface ModelChoice {
  readonly providerID: string;
  readonly modelID: string;
  /** Model variant. `undefined` uses the model default. */
  readonly variant: string | undefined;
}

export interface AutomodeConfig {
  /**
   * Stage 2 reviewer: reasons about every action that stage 1 flags, and
   * makes the final call. Also the only model when `fastModel` is off.
   */
  readonly model: ModelChoice;
  /**
   * Optional stage 1 filter: a fast model that answers one word and errs
   * toward blocking. `undefined`, the default, sends every action to `model`.
   */
  readonly fastModel: ModelChoice | undefined;
  readonly timeoutMs: number;
  readonly fastTimeoutMs: number;
  /**
   * When the classifier fails after a retry, leave the permission ask to
   * opencode (`true`), or deny the action (`false`, the default). In auto
   * mode a left ask is approved by the client, so only interactive users
   * should turn this on. The plugin itself never approves without a verdict.
   */
  readonly failOpen: boolean;
  /** Refuse to read known secret files such as `.env` and private keys. */
  readonly protectSecretFiles: boolean;
  /** Add the auto mode note to the system prompt so a denial leads to a safer route. */
  readonly continueOnDeny: boolean;
  /**
   * Classify shell commands that an allow rule approved when they can run
   * arbitrary code (interpreters, package runners, `find -exec`) or touch
   * secret files. A broad allow rule then cannot skip the classifier.
   */
  readonly reviewAllowedCode: boolean;
  /** Warn the agent about tool output that looks like a prompt injection. */
  readonly injectionProbe: boolean;
  /** Blocks in a row before the agent is told to stop and ask the user. */
  readonly maxConsecutiveDenials: number;
  /** Blocks in one session before auto mode pauses until the next user message. */
  readonly maxTotalDenials: number;
  /** Extra trusted destinations for the environment slot, such as a GitHub org or a bucket. */
  readonly trustedEnvironment: readonly string[];
  /** Extra block rules appended to the defaults. */
  readonly blockRules: readonly string[];
  /** Extra allow exceptions appended to the defaults. */
  readonly allowRules: readonly string[];
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

/**
 * Reviewer default: DeepSeek V4.1 Flash at high reasoning from the OpenCode Go
 * subscription. In `bun run bench` it allowed no risky action and blocked no
 * routine one across every round, at about 4.3 s per action.
 */
export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
export const DEFAULT_VARIANT = "high";
export const DEFAULT_CONFIG = {
  timeoutMs: 30_000,
  fastTimeoutMs: 10_000,
  failOpen: false,
  protectSecretFiles: true,
  continueOnDeny: true,
  reviewAllowedCode: true,
  injectionProbe: true,
  maxConsecutiveDenials: 3,
  maxTotalDenials: 20,
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
      model: readModel(source, "model", "variant", DEFAULT_MODEL, DEFAULT_VARIANT, warnings),
      fastModel: readFastModel(source, warnings),
      timeoutMs: readNumber(source, "timeoutMs", DEFAULT_CONFIG.timeoutMs, 1000, 120_000, warnings),
      fastTimeoutMs: readNumber(source, "fastTimeoutMs", DEFAULT_CONFIG.fastTimeoutMs, 1000, 60_000, warnings),
      failOpen: readBoolean(source, "failOpen", DEFAULT_CONFIG.failOpen, warnings),
      protectSecretFiles: readBoolean(source, "protectSecretFiles", DEFAULT_CONFIG.protectSecretFiles, warnings),
      continueOnDeny: readBoolean(source, "continueOnDeny", DEFAULT_CONFIG.continueOnDeny, warnings),
      reviewAllowedCode: readBoolean(source, "reviewAllowedCode", DEFAULT_CONFIG.reviewAllowedCode, warnings),
      injectionProbe: readBoolean(source, "injectionProbe", DEFAULT_CONFIG.injectionProbe, warnings),
      maxConsecutiveDenials: readNumber(source, "maxConsecutiveDenials", DEFAULT_CONFIG.maxConsecutiveDenials, 1, 100, warnings),
      maxTotalDenials: readNumber(source, "maxTotalDenials", DEFAULT_CONFIG.maxTotalDenials, 1, 1000, warnings),
      trustedEnvironment: readStringList(source, "trustedEnvironment", warnings),
      blockRules: readStringList(source, "blockRules", warnings),
      allowRules: readStringList(source, "allowRules", warnings),
      cacheTtlMs: readNumber(source, "cacheTtlMs", DEFAULT_CONFIG.cacheTtlMs, 0, 24 * 60 * 60_000, warnings),
      maxCacheEntries: readNumber(source, "maxCacheEntries", DEFAULT_CONFIG.maxCacheEntries, 0, 10_000, warnings),
      logFile: readLogFile(source, warnings),
    },
    warnings,
  };
}

/** `provider/model#variant` for logs. */
export function formatModel(model: ModelChoice): string {
  return `${model.providerID}/${model.modelID}${model.variant === undefined ? "" : `#${model.variant}`}`;
}

// Readers

/**
 * Read a model as `provider/model`, or `provider/model#variant`, plus its
 * separate variant option. The separate option wins; an empty string turns
 * the variant off and uses the model default.
 */
function readModel(
  source: Record<string, unknown>,
  modelKey: string,
  variantKey: string,
  fallbackModel: string,
  fallbackVariant: string,
  warnings: string[],
): ModelChoice {
  const value = source[modelKey];
  const isDefault = value === undefined;
  let parsed = typeof value === "string" ? splitModel(value.trim()) : undefined;
  if (!isDefault && parsed === undefined) {
    warnings.push(`${modelKey} must look like "provider/model"; using ${fallbackModel}`);
  }
  const usesFallback = parsed === undefined;
  parsed ??= splitModel(fallbackModel)!;

  const variantValue = source[variantKey];
  let variant: string | undefined;
  if (variantValue === undefined) {
    // A custom model keeps its own default unless it names a variant.
    variant = parsed.variant ?? (usesFallback ? fallbackVariant : undefined);
  } else if (typeof variantValue === "string") {
    variant = variantValue.trim() === "" ? undefined : variantValue.trim();
  } else {
    warnings.push(`${variantKey} must be a string; using the model default`);
    variant = parsed.variant;
  }
  return { providerID: parsed.providerID, modelID: parsed.modelID, variant };
}

/**
 * Read the optional stage 1 model. Absent, `false`, `""`, or invalid turns
 * stage 1 off. It is off by default: Muse Spark at minimal reasoning was a good
 * fast filter (about 1 s), but OpenCode Go restricted the account after it saw
 * security-classifier prompts, and DeepSeek at low reasoning saves too little
 * time to be worth a final ALLOW without review.
 */
function readFastModel(source: Record<string, unknown>, warnings: string[]): ModelChoice | undefined {
  const value = source.fastModel;
  if (value === undefined || value === false || value === "") return undefined;
  if (typeof value !== "string" || splitModel(value.trim()) === undefined) {
    warnings.push('fastModel must look like "provider/model"; stage 1 is off');
    return undefined;
  }
  return readModel(source, "fastModel", "fastVariant", value.trim(), "", warnings);
}

/** Split `provider/model#variant`, or `undefined` when provider or model is empty. */
export function splitModel(text: string): { providerID: string; modelID: string; variant: string | undefined } | undefined {
  const hash = text.indexOf("#");
  const spec = hash === -1 ? text : text.slice(0, hash);
  const variant = hash === -1 ? undefined : text.slice(hash + 1).trim() || undefined;
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return { providerID: spec.slice(0, slash), modelID: spec.slice(slash + 1), variant };
}

/** Read the optional log file path. */
function readLogFile(source: Record<string, unknown>, warnings: string[]): string | undefined {
  const value = source.logFile;
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  warnings.push("logFile must be a non-empty path; logging to the console only");
  return undefined;
}

/** Read a list of non-empty strings. Other entries are dropped with a warning. */
function readStringList(source: Record<string, unknown>, key: string, warnings: string[]): readonly string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${key} must be a list of strings; ignoring it`);
    return [];
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  if (items.length !== value.length) warnings.push(`${key} has entries that are not non-empty strings; ignoring them`);
  return items;
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
