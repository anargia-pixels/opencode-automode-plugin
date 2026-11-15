import { isRecord, readStringField } from "./guards";

// Types

/** One transcript entry the classifier may see: a user message or an agent tool call. */
export type TranscriptEntry =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "tool"; readonly id: string; readonly name: string; readonly input: unknown };

/** A tool call seen in `execute.before`, keyed by call id. */
export interface ToolCallRecord {
  readonly sessionID: string;
  readonly tool: string;
  readonly input: unknown;
}

// Global constants

/** Transcript entries kept per session; rendering trims further to a size budget. */
const MAX_ENTRIES = 80;
/** Longest user message kept; the head and tail survive. */
const MAX_USER_MESSAGE_CHARS = 4000;
/** Bound on remembered sessions and tool calls, so long runs cannot grow memory. */
const MAX_SESSIONS = 200;
const MAX_TOOL_CALLS = 1000;
/** Blocked actions kept per session, so close retries are recognized. */
const MAX_RECENT_BLOCKS = 5;
/** Files written by the agent kept per session. */
const MAX_WRITTEN_FILES = 50;
/** Injection suspicions kept per session. */
const MAX_SUSPICIONS = 3;

/** Tools whose input names a file the agent writes. */
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "patch"]);

// Tracker

/**
 * Context the classifier sees besides the action.
 *
 * Following the Claude Code auto mode design, it keeps only the user's
 * messages and the agent's tool calls. Assistant prose and tool results are
 * left out: the agent cannot argue its way past the classifier, and text it
 * read from files or the web cannot talk the classifier into anything.
 */
export class ContextTracker {
  private readonly transcripts = new Map<string, readonly TranscriptEntry[]>();
  private readonly userMessageCounts = new Map<string, number>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  /** Calls seen in `execute.before` that the transcript does not show yet, per session. */
  private readonly pendingCalls = new Map<string, readonly string[]>();
  private readonly blocks = new Map<string, readonly string[]>();
  private readonly writtenFiles = new Map<string, readonly string[]>();
  private readonly suspicions = new Map<string, readonly string[]>();

  /**
   * Record the transcript from the request the agent is about to send.
   * Returns true when a new user message arrived since the last update.
   */
  updateFromMessages(sessionID: string, messages: readonly unknown[]): boolean {
    const entries: TranscriptEntry[] = [];
    for (const message of messages) {
      if (!isRecord(message) || !Array.isArray(message.content)) continue;
      if (message.role === "user") {
        const text = message.content
          .flatMap((part: unknown) => (isRecord(part) && part.type === "text" ? [readStringField(part, "text") ?? ""] : []))
          .join("\n")
          .trim();
        if (text !== "") entries.push({ kind: "user", text: clip(text, MAX_USER_MESSAGE_CHARS) });
      } else if (message.role === "assistant") {
        // Only the calls: assistant prose is the agent's own framing.
        for (const part of message.content) {
          if (!isRecord(part) || part.type !== "tool-call") continue;
          const id = readStringField(part, "id") ?? "";
          const name = readStringField(part, "name") ?? "unknown";
          entries.push({ kind: "tool", id, name, input: part.input });
        }
      }
    }
    if (entries.length === 0) return false;
    remember(this.transcripts, sessionID, entries.slice(-MAX_ENTRIES), MAX_SESSIONS);

    const shown = new Set(entries.flatMap((entry) => (entry.kind === "tool" ? [entry.id] : [])));
    const pending = (this.pendingCalls.get(sessionID) ?? []).filter((id) => !shown.has(id));
    remember(this.pendingCalls, sessionID, pending, MAX_SESSIONS);

    const userCount = entries.filter((entry) => entry.kind === "user").length;
    const previous = this.userMessageCounts.get(sessionID);
    remember(this.userMessageCounts, sessionID, userCount, MAX_SESSIONS);
    return previous !== undefined && userCount > previous;
  }

  /**
   * The session transcript, oldest first: recorded messages plus calls made
   * since then, without the call being judged.
   */
  transcriptFor(sessionID: string, excludeCallID: string | undefined = undefined): readonly TranscriptEntry[] {
    const entries = [...(this.transcripts.get(sessionID) ?? [])];
    for (const id of this.pendingCalls.get(sessionID) ?? []) {
      const call = this.toolCalls.get(id);
      if (call !== undefined) entries.push({ kind: "tool", id, name: call.tool, input: call.input });
    }
    return excludeCallID === undefined ? entries : entries.filter((entry) => entry.kind !== "tool" || entry.id !== excludeCallID);
  }

  /** The session's user messages, oldest first. */
  userMessagesFor(sessionID: string): readonly string[] {
    return (this.transcripts.get(sessionID) ?? []).flatMap((entry) => (entry.kind === "user" ? [entry.text] : []));
  }

  /** Record a tool call's input before it runs or asks for permission. */
  recordToolCall(sessionID: string, callID: string, tool: string, input: unknown): void {
    remember(this.toolCalls, callID, { sessionID, tool, input }, MAX_TOOL_CALLS);
    const pending = this.pendingCalls.get(sessionID) ?? [];
    if (!pending.includes(callID)) remember(this.pendingCalls, sessionID, [...pending, callID].slice(-MAX_ENTRIES), MAX_SESSIONS);
    if (WRITE_TOOLS.has(tool)) {
      for (const path of writtenPaths(input)) this.recordWrittenFile(sessionID, path);
    }
  }

  /** The tool call a permission ask came from, when known. */
  toolCallFor(callID: string | undefined): ToolCallRecord | undefined {
    return callID === undefined ? undefined : this.toolCalls.get(callID);
  }

  /** Files the agent wrote or edited in the session, oldest first. */
  writtenFilesFor(sessionID: string): readonly string[] {
    return this.writtenFiles.get(sessionID) ?? [];
  }

  /** Record an action the classifier blocked in this session. */
  recordBlock(sessionID: string, action: string): void {
    const previous = this.blocks.get(sessionID) ?? [];
    remember(this.blocks, sessionID, [...previous, action].slice(-MAX_RECENT_BLOCKS), MAX_SESSIONS);
  }

  /** Actions blocked earlier in the session, oldest first. */
  recentBlocksFor(sessionID: string): readonly string[] {
    return this.blocks.get(sessionID) ?? [];
  }

  /** Record that a tool result in this session looked like a prompt injection. */
  recordSuspicion(sessionID: string, source: string): void {
    const previous = (this.suspicions.get(sessionID) ?? []).filter((item) => item !== source);
    remember(this.suspicions, sessionID, [...previous, source].slice(-MAX_SUSPICIONS), MAX_SESSIONS);
  }

  /** Sources of suspected prompt injections in the session. */
  suspicionsFor(sessionID: string): readonly string[] {
    return this.suspicions.get(sessionID) ?? [];
  }

  private recordWrittenFile(sessionID: string, path: string): void {
    const previous = (this.writtenFiles.get(sessionID) ?? []).filter((item) => item !== path);
    remember(this.writtenFiles, sessionID, [...previous, path].slice(-MAX_WRITTEN_FILES), MAX_SESSIONS);
  }
}

// Helpers

/** Paths a write, edit, or patch tool input touches. */
export function writtenPaths(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const paths: string[] = [];
  for (const key of ["path", "filePath", "file_path", "file"]) {
    const value = readStringField(input, key);
    if (value !== undefined) paths.push(value);
  }
  for (const key of ["patch", "patchText", "input"]) {
    const patch = readStringField(input, key);
    if (patch === undefined) continue;
    for (const match of patch.matchAll(/^(?:\*\*\* (?:Add|Update|Delete) File: |\+\+\+ (?:b\/)?)(.+)$/gm)) {
      const path = match[1]?.trim();
      if (path !== undefined && path !== "" && path !== "/dev/null") paths.push(path);
    }
  }
  return [...new Set(paths)];
}

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
