import type { PluginOptions } from "@opencode/plugin";
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
/**
 * Reviewer default: DeepSeek V4.1 Flash at high reasoning from the OpenCode Go
 * subscription. In `bun run bench` it allowed no risky action and blocked no
 * routine one across every round, at about 4.3 s per action.
 */
export declare const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
export declare const DEFAULT_VARIANT = "high";
export declare const DEFAULT_CONFIG: {
    readonly timeoutMs: 30000;
    readonly fastTimeoutMs: 10000;
    readonly failOpen: false;
    readonly protectSecretFiles: true;
    readonly continueOnDeny: true;
    readonly reviewAllowedCode: true;
    readonly injectionProbe: true;
    readonly maxConsecutiveDenials: 3;
    readonly maxTotalDenials: 20;
    readonly cacheTtlMs: number;
    readonly maxCacheEntries: 500;
};
/**
 * Read plugin options into a validated config.
 *
 * Invalid values fall back to the default and produce a warning instead of an
 * error, so a typo in the config cannot stop opencode from starting.
 */
export declare function parseConfig(options?: PluginOptions | undefined): ParsedConfig;
/** `provider/model#variant` for logs. */
export declare function formatModel(model: ModelChoice): string;
/** Split `provider/model#variant`, or `undefined` when provider or model is empty. */
export declare function splitModel(text: string): {
    providerID: string;
    modelID: string;
    variant: string | undefined;
} | undefined;
