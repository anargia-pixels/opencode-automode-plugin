export interface CommandInput {
    readonly command: string;
    /** Directory the command runs in; relative paths depend on it. */
    readonly cwd: string;
    /** Project root; the agent's normal workspace. */
    readonly projectRoot: string;
    /** The agent's own short description of the command. Not user authorization. */
    readonly description?: string;
    /** Recent user messages, oldest first. The only source of user intent. */
    readonly userMessages: readonly string[];
    /** Commands blocked earlier in this session, oldest first. */
    readonly recentBlocks?: readonly string[];
}
export type Decision = "allow" | "block";
export interface Verdict {
    readonly decision: Decision;
    readonly reason: string;
}
/** Send one prompt to the classifier model and return its text. */
export type GenerateText = (prompt: string, signal: AbortSignal) => Promise<string>;
/** Build the full classifier prompt for one command. */
export declare function buildPrompt(input: CommandInput): string;
/**
 * Read the verdict from the model's reply. Accepts surrounding text or a code
 * fence. Throws when no valid verdict is found, so the caller can fail safely.
 */
export declare function parseVerdict(text: string): Verdict;
/** Ask the model about one command, with a timeout. Throws on failure. */
export declare function classify(generate: GenerateText, input: CommandInput, timeoutMs: number): Promise<Verdict>;
