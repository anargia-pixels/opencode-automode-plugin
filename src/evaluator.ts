import type { Verdict } from "./classifier";

// Types

export type EvaluationResult =
  | { readonly ok: true; readonly verdict: Verdict }
  | { readonly ok: false; readonly error: string };

/** Judges one prompt context. Throws on failure. */
export type ContextQuery = (context: string) => Promise<Verdict>;

export interface EvaluatorOptions {
  readonly cacheTtlMs: number;
  readonly maxCacheEntries: number;
}

interface CacheEntry {
  readonly result: EvaluationResult;
  readonly expiresAt: number; // clock time in milliseconds
}

// Evaluator

/**
 * Evaluate actions with a small TTL cache keyed by the full prompt context.
 *
 * The context holds the action, transcript, directory, and recent blocks, so
 * a hit means the classifier would see exactly the same thing. Requests in
 * flight are shared, and failures are never cached.
 */
export class Evaluator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<EvaluationResult>>();

  constructor(
    private readonly query: ContextQuery,
    private readonly options: EvaluatorOptions,
  ) {}

  /** Judge one context. Reuses a fresh cached verdict or a request in flight. */
  async evaluate(context: string): Promise<EvaluationResult> {
    const cached = this.cache.get(context);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      // Move the entry to the end so that eviction removes the least recent.
      this.cache.delete(context);
      this.cache.set(context, cached);
      return cached.result;
    }

    const pending = this.inflight.get(context);
    if (pending !== undefined) return pending;

    const promise = this.run(context)
      .then((result) => {
        if (result.ok) this.store(context, result);
        return result;
      })
      .finally(() => {
        this.inflight.delete(context);
      });
    this.inflight.set(context, promise);
    return promise;
  }

  /** Query the classifier. Never throws. */
  private async run(context: string): Promise<EvaluationResult> {
    try {
      return { ok: true, verdict: await this.query(context) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Cache a result and evict the oldest entries above the size limit. */
  private store(key: string, result: EvaluationResult): void {
    if (this.options.cacheTtlMs <= 0 || this.options.maxCacheEntries <= 0) return;
    this.cache.set(key, { result, expiresAt: Date.now() + this.options.cacheTtlMs });
    while (this.cache.size > this.options.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
    }
  }
}
