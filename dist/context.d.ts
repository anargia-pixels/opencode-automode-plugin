/** One transcript entry the classifier may see: a user message or an agent tool call. */
export type TranscriptEntry = {
    readonly kind: "user";
    readonly text: string;
} | {
    readonly kind: "tool";
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
};
/** A tool call seen in `execute.before`, keyed by call id. */
export interface ToolCallRecord {
    readonly sessionID: string;
    readonly tool: string;
    readonly input: unknown;
}
/**
 * Context the classifier sees besides the action.
 *
 * Following the Claude Code auto mode design, it keeps only the user's
 * messages and the agent's tool calls. Assistant prose and tool results are
 * left out: the agent cannot argue its way past the classifier, and text it
 * read from files or the web cannot talk the classifier into anything.
 */
export declare class ContextTracker {
    private readonly transcripts;
    private readonly userMessageCounts;
    private readonly toolCalls;
    /** Calls seen in `execute.before` that the transcript does not show yet, per session. */
    private readonly pendingCalls;
    private readonly blocks;
    private readonly writtenFiles;
    private readonly suspicions;
    /**
     * Record the transcript from the request the agent is about to send.
     * Returns true when a new user message arrived since the last update.
     */
    updateFromMessages(sessionID: string, messages: readonly unknown[]): boolean;
    /**
     * The session transcript, oldest first: recorded messages plus calls made
     * since then, without the call being judged.
     */
    transcriptFor(sessionID: string, excludeCallID?: string | undefined): readonly TranscriptEntry[];
    /** The session's user messages, oldest first. */
    userMessagesFor(sessionID: string): readonly string[];
    /** Record a tool call's input before it runs or asks for permission. */
    recordToolCall(sessionID: string, callID: string, tool: string, input: unknown): void;
    /** The tool call a permission ask came from, when known. */
    toolCallFor(callID: string | undefined): ToolCallRecord | undefined;
    /** Files the agent wrote or edited in the session, oldest first. */
    writtenFilesFor(sessionID: string): readonly string[];
    /** Record an action the classifier blocked in this session. */
    recordBlock(sessionID: string, action: string): void;
    /** Actions blocked earlier in the session, oldest first. */
    recentBlocksFor(sessionID: string): readonly string[];
    /** Record that a tool result in this session looked like a prompt injection. */
    recordSuspicion(sessionID: string, source: string): void;
    /** Sources of suspected prompt injections in the session. */
    suspicionsFor(sessionID: string): readonly string[];
    private recordWrittenFile;
}
/** Paths a write, edit, or patch tool input touches. */
export declare function writtenPaths(input: unknown): string[];
/** Cap text, keeping the head and tail. */
export declare function clip(text: string, maxChars: number): string;
