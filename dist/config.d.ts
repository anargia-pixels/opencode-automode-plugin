import type { PluginOptions } from "@opencode/plugin";
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
/** DeepSeek V4.1 Flash from the OpenCode Go subscription, at low reasoning for speed. */
export declare const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
export declare const DEFAULT_VARIANT = "low";
export declare const DEFAULT_CONFIG: {
    readonly timeoutMs: 20000;
    readonly failOpen: false;
    readonly protectSecretFiles: true;
    readonly continueOnDeny: true;
    readonly maxConsecutiveDenials: 3;
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
