import type { Plugin } from "@opencode/plugin";
/**
 * OpenCode plugin that gives shell permission asks to a fast LLM classifier.
 *
 * Only shell commands that opencode's rules leave at `ask` are classified;
 * commands the config already allows or denies are untouched. A safe verdict
 * approves the ask with no prompt. A block denies it with a reason, and the
 * model is told to find a safer route instead of stopping. The classifier
 * sees recent user messages, the working directory, and the agent's own
 * description of the command, so it can judge the command against the task.
 *
 * The plugin is a plain object typed as `Plugin.Plugin`; `Plugin.define` only
 * returns its argument, so the published bundle needs no runtime dependency.
 */
export declare const AutomodePlugin: Plugin.Plugin;
export default AutomodePlugin;
