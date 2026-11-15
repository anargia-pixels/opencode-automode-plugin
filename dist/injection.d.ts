/**
 * The first pattern that matches the tool output, or `undefined`.
 *
 * Heuristic on purpose: it runs on every tool result, so it must cost no
 * model call. The transcript classifier never sees tool output, so the probe
 * only has to make the agent re-anchor on the user's request; the two layers
 * compound.
 */
export declare function detectInjection(tool: string, text: string): string | undefined;
/** Text of a tool result's content, for scanning. */
export declare function resultText(content: unknown): string;
/** Tool result content with the warning put first, in the content's own shape. */
export declare function withWarning(content: unknown, warning: string): unknown;
