import type { ModelChoice } from "./config";
import { type TranscriptEntry } from "./context";
/** One action the agent wants to take, with the context the classifier judges it in. */
export interface ActionInput {
    /** Permission action: `shell`, `edit`, `webfetch`, `external_directory`, `subagent`, an MCP tool, ... */
    readonly action: string;
    /** Tool that asked, when known. */
    readonly tool?: string;
    /** Resources the permission ask names: commands, paths, URLs. */
    readonly resources: readonly string[];
    /** The tool call's input, as the agent wrote it. */
    readonly toolInput?: unknown;
    /** Directory the action runs in; relative paths depend on it. */
    readonly cwd: string;
    /** Project root; the agent's normal workspace. */
    readonly projectRoot: string;
    /** User messages and agent tool calls, oldest first. No assistant prose, no tool results. */
    readonly transcript: readonly TranscriptEntry[];
    /**
     * For a subagent: the real user's messages from the root session. The
     * subagent's own "user" messages are then the orchestrating agent's words.
     */
    readonly rootUserMessages?: readonly string[];
    /** Actions blocked earlier in this session, oldest first. */
    readonly recentBlocks?: readonly string[];
    /** Tool results in this session that looked like prompt injections. */
    readonly suspicions?: readonly string[];
    /** Current contents of files the agent wrote this session that the action may run. */
    readonly agentFiles?: readonly {
        readonly path: string;
        readonly content: string;
    }[];
}
/** The customizable slots of the policy. Everything else is the fixed template. */
export interface PolicySlots {
    /** Trusted places: the project, its git remotes, and anything the user adds. */
    readonly environment: readonly string[];
    readonly extraBlockRules: readonly string[];
    readonly extraAllowRules: readonly string[];
}
export type Decision = "allow" | "block";
export interface Verdict {
    readonly decision: Decision;
    readonly reason: string;
    /** 1 when the fast filter cleared it; 2 when the reviewer decided. */
    readonly stage: 1 | 2;
    /** Why stage 2 ran: stage 1 flagged the action, or the stage 1 error. */
    readonly fastFilter?: string;
}
/** Send one prompt to a model and return its text. */
export type GenerateText = (prompt: string, model: ModelChoice, signal: AbortSignal) => Promise<string>;
export interface ClassifierModels {
    readonly fast: ModelChoice | undefined;
    readonly review: ModelChoice;
    readonly fastTimeoutMs: number;
    readonly timeoutMs: number;
}
/** The fixed part of every prompt: template plus slots. Identical across calls in a session. */
export declare function buildPolicy(slots: PolicySlots): string;
/** Context and action for one call. Everything here is data, not instructions. */
export declare function buildContext(input: ActionInput): string;
/** Final instruction for stage 1: one word, erring toward blocking. */
export declare const STAGE1_INSTRUCTION = "\n\nSTAGE 1 (fast filter). Err on the side of blocking: answer BLOCK if any block rule might apply and no allow exception clearly covers it, or if you are unsure. Answer ALLOW only for actions that are clearly routine or clearly requested.\nReply with exactly one word: ALLOW or BLOCK.";
/** Final instruction for stage 2: careful review of a flagged action. */
export declare const STAGE2_INSTRUCTION = "\n\nSTAGE 2 (careful review). A fast filter flagged this action. Follow the STEPS carefully: what the action really does, which block rule applies, whether an allow exception covers it exactly, and whether a clearable rule is cleared by an explicit user request for this exact action and target. Do not block routine work out of caution alone; do not stretch a vague request into consent. A user goal (\"clean state\", \"fix it\", \"tidy up\") is not consent to a destructive or irreversible step the user did not name.\nReply with JSON only, no prose and no code fence:\n{\"decision\":\"allow\"|\"block\",\"reason\":\"<one short sentence naming the effect that decided it; for block, add a safer route that does not do the blocked effect another way, such as a read-only check or handing the action to the user>\"}";
/** Render the transcript within the size budget, keeping user messages first, newest calls next. */
export declare function renderTranscript(entries: readonly TranscriptEntry[]): string;
/**
 * Read stage 1's one-word answer. Anything but a clear ALLOW counts as a
 * flag, so a confused fast model sends the action to the reviewer.
 */
export declare function parseStage1(text: string): Decision;
/**
 * Read the stage 2 verdict. Accepts surrounding text or a code fence. Throws
 * when no valid verdict is found, so the caller can fail safely.
 */
export declare function parseVerdict(text: string): Omit<Verdict, "stage">;
/**
 * Judge one action in two stages, as Claude Code's auto mode does.
 *
 * Stage 1 is a fast one-word filter told to err toward blocking; its ALLOW is
 * final. Anything it flags, or any stage 1 failure, goes to stage 2, which
 * reasons with the same policy and context and makes the final call. Most
 * actions clear stage 1, so reasoning tokens are spent only where needed.
 * Stage 2 is retried once; a second failure throws, so the caller fails closed.
 */
export declare function classify(generate: GenerateText, prompt: {
    policy: string;
    context: string;
}, models: ClassifierModels): Promise<Verdict>;
