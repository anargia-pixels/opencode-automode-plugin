import type { CommandInput, Verdict } from "./classifier";
export type EvaluationResult = {
    readonly ok: true;
    readonly verdict: Verdict;
} | {
    readonly ok: false;
    readonly error: string;
};
/** Judges one command. Throws on failure. */
export type CommandQuery = (input: CommandInput) => Promise<Verdict>;
export interface CommandEvaluatorOptions {
    readonly cacheTtlMs: number;
    readonly maxCacheEntries: number;
}
/**
 * Evaluate commands with a small TTL cache.
 *
 * Cache keys include the directory, the user messages, and recent blocks, because the same
 * command can be fine in one place or for one request and not another.
 * Failures are never cached, so a transient model error does not stick.
 */
export declare class CommandEvaluator {
    private readonly query;
    private readonly options;
    private readonly cache;
    private readonly inflight;
    constructor(query: CommandQuery, options: CommandEvaluatorOptions);
    /** Judge one command. Reuses a fresh cached verdict or a request in flight. */
    evaluate(input: CommandInput): Promise<EvaluationResult>;
    /** Query the classifier, retrying once on failure. Never throws. */
    private run;
    /** Cache a result and evict the oldest entries above the size limit. */
    private store;
}
