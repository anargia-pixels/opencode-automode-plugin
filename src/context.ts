import { isRecord, readStringField } from "./guards";

// Types

/** What the agent said about one shell call, from the tool input. */
export interface ShellCall {
  readonly command: string;
  readonly cwd: string | undefined;
  readonly description: string | undefined;
}

// Global constants

/** User messages kept per session; the latest ones carry the current intent. */
const MAX_USER_MESSAGES = 3;
/** Longest user message kept; the head and tail survive. */
const MAX_USER_MESSAGE_CHARS = 2000;
/** Bound on remembered sessions and shell calls, so long runs cannot grow memory. */
const MAX_SESSIONS = 200;
const MAX_SHELL_CALLS = 500;
/** Blocked commands kept per session, so close retries are recognized. */
const MAX_RECENT_BLOCKS = 5;

// Tracker

/**
 * Context the classifier sees besides the command.
 *
 * Only the user's own messages are kept, not assistant text or tool output,
 * following the Claude Code auto mode design: text the agent read from files
 * or the web cannot then talk the classifier into approving a command.
 */
export class ContextTracker {
  private readonly userMessages = new Map<string, readonly string[]>();
  private readonly shellCalls = new Map<string, ShellCall>();
  private readonly blocks = new Map<string, readonly string[]>();

  /** Record the latest user messages from the request the agent is about to send. */
  updateFromMessages(sessionID: string, messages: readonly unknown[]): void {
    const texts: string[] = [];
    for (const message of messages) {
      if (!isRecord(message) || message.role !== "user" || !Array.isArray(message.content)) continue;
      const text = message.content
        .flatMap((part: unknown) => (isRecord(part) && part.type === "text" ? [readStringField(part, "text") ?? ""] : []))
        .join("\n")
        .trim();
      if (text !== "") texts.push(clip(text, MAX_USER_MESSAGE_CHARS));
    }
    if (texts.length === 0) return;
    remember(this.userMessages, sessionID, texts.slice(-MAX_USER_MESSAGES), MAX_SESSIONS);
  }

  /** Recent user messages for the session, oldest first. */
  userMessagesFor(sessionID: string): readonly string[] {
    return this.userMessages.get(sessionID) ?? [];
  }

  /** Record a command the classifier blocked in this session. */
  recordBlock(sessionID: string, command: string): void {
    const previous = this.blocks.get(sessionID) ?? [];
    remember(this.blocks, sessionID, [...previous, command].slice(-MAX_RECENT_BLOCKS), MAX_SESSIONS);
  }

  /** Commands blocked earlier in the session, oldest first. */
  recentBlocksFor(sessionID: string): readonly string[] {
    return this.blocks.get(sessionID) ?? [];
  }

  /** Record a shell tool call's input before it asks for permission. */
  recordShellCall(callID: string, input: unknown): void {
    if (!isRecord(input)) return;
    const command = readStringField(input, "command");
    if (command === undefined) return;
    remember(
      this.shellCalls,
      callID,
      { command, cwd: readStringField(input, "workdir"), description: readStringField(input, "description") },
      MAX_SHELL_CALLS,
    );
  }

  /** The shell call a permission ask came from, when known. */
  shellCallFor(callID: string | undefined): ShellCall | undefined {
    return callID === undefined ? undefined : this.shellCalls.get(callID);
  }
}

// Helpers

/** Set a map entry as the newest and drop the oldest entries above the limit. */
function remember<V>(map: Map<string, V>, key: string, value: V, limit: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/** Cap text, keeping the head and tail. */
export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n…[truncated]…\n${text.slice(-half)}`;
}
