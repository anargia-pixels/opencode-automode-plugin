import type { CommandInput, Verdict } from "./classifier";

// Types

export type EvaluationResult =
  | { readonly ok: true; readonly verdict: Verdict }
  | { readonly ok: false; readonly error: string };

/** Judges one command. Throws on failure. */
export type CommandQuery = (input: CommandInput) => Promise<Verdict>;

export interface CommandEvaluatorOptions {
  readonly cacheTtlMs: number;
  readonly maxCacheEntries: number;
}

interface CacheEntry {
  readonly result: EvaluationResult;
  readonly expiresAt: number; // clock time in milliseconds
}

// Evaluator

/**
 * Evaluate commands with a small TTL cache.
 *
 * Cache keys include the directory, the user messages, and recent blocks, because the same
 * command can be fine in one place or for one request and not another.
 * Failures are never cached, so a transient model error does not stick.
 */
export class CommandEvaluator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<EvaluationResult>>();

  constructor(
    private readonly query: CommandQuery,
    private readonly options: CommandEvaluatorOptions,
  ) {}

  /** Judge one command. Reuses a fresh cached verdict or a request in flight. */
  async evaluate(input: CommandInput): Promise<EvaluationResult> {
    const key = cacheKey(input);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      // Move the entry to the end so that eviction removes the least recent.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.result;
    }

    const pending = this.inflight.get(key);
    if (pending !== undefined) return pending;

    const promise = this.run(input)
      .then((result) => {
        if (result.ok) this.store(key, result);
        return result;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Query the classifier, retrying once on failure. Never throws. */
  private async run(input: CommandInput): Promise<EvaluationResult> {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return { ok: true, verdict: await this.query(input) };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { ok: false, error: lastError };
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

/** Cache key for a command in its directory, for the current user request. */
function cacheKey(input: CommandInput): string {
  return [
    input.cwd,
    input.description ?? "",
    input.userMessages.join("\u0001"),
    (input.recentBlocks ?? []).join("\u0001"),
    input.command,
  ].join("\u0000");
}
