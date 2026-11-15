import type { Verdict } from "./classifier";
export type EvaluationResult = {
    readonly ok: true;
    readonly verdict: Verdict;
} | {
    readonly ok: false;
    readonly error: string;
};
/** Judges one prompt context. Throws on failure. */
export type ContextQuery = (context: string) => Promise<Verdict>;
export interface EvaluatorOptions {
    readonly cacheTtlMs: number;
    readonly maxCacheEntries: number;
}
/**
 * Evaluate actions with a small TTL cache keyed by the full prompt context.
 *
 * The context holds the action, transcript, directory, and recent blocks, so
 * a hit means the classifier would see exactly the same thing. Requests in
 * flight are shared, and failures are never cached.
 */
export declare class Evaluator {
    private readonly query;
    private readonly options;
    private readonly cache;
    private readonly inflight;
    constructor(query: ContextQuery, options: EvaluatorOptions);
    /** Judge one context. Reuses a fresh cached verdict or a request in flight. */
    evaluate(context: string): Promise<EvaluationResult>;
    /** Query the classifier. Never throws. */
    private run;
    /** Cache a result and evict the oldest entries above the size limit. */
    private store;
}
