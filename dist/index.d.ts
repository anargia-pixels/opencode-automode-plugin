import type { Plugin } from "@opencode/plugin";
/**
 * OpenCode plugin that hands permission asks to an LLM classifier, after the
 * design of Claude Code's auto mode:
 *
 * - Tier 1: read-only tools and your allow rules run as before, except allowed
 *   shell commands that can run arbitrary code, which go to the classifier.
 * - Tier 2: edits inside the project follow your rules (allowed by default).
 * - Tier 3: every action your rules leave at `ask` goes to the
 *   classifier that sees your messages and the agent's tool calls, but no
 *   assistant prose and no tool results.
 *
 * Tool output that looks like a prompt injection gets a warning first. A
 * block returns a reason and tells the agent to find a safer route. After
 * repeated blocks the agent is told to stop, and after many the session
 * pauses until you write again.
 *
 * The plugin is a plain object typed as `Plugin.Plugin`; `Plugin.define` only
 * returns its argument, so the published bundle needs no runtime dependency.
 */
export declare const AutomodePlugin: Plugin.Plugin;
export default AutomodePlugin;
