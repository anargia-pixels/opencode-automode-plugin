/** What the agent said about one shell call, from the tool input. */
export interface ShellCall {
    readonly command: string;
    readonly cwd: string | undefined;
    readonly description: string | undefined;
}
/**
 * Context the classifier sees besides the command.
 *
 * Only the user's own messages are kept, not assistant text or tool output,
 * following the Claude Code auto mode design: text the agent read from files
 * or the web cannot then talk the classifier into approving a command.
 */
export declare class ContextTracker {
    private readonly userMessages;
    private readonly shellCalls;
    private readonly blocks;
    /** Record the latest user messages from the request the agent is about to send. */
    updateFromMessages(sessionID: string, messages: readonly unknown[]): void;
    /** Recent user messages for the session, oldest first. */
    userMessagesFor(sessionID: string): readonly string[];
    /** Record a command the classifier blocked in this session. */
    recordBlock(sessionID: string, command: string): void;
    /** Commands blocked earlier in the session, oldest first. */
    recentBlocksFor(sessionID: string): readonly string[];
    /** Record a shell tool call's input before it asks for permission. */
    recordShellCall(callID: string, input: unknown): void;
    /** The shell call a permission ask came from, when known. */
    shellCallFor(callID: string | undefined): ShellCall | undefined;
}
/** Cap text, keeping the head and tail. */
export declare function clip(text: string, maxChars: number): string;
