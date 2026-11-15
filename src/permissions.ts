// Global constants

/** Tool id of the shell tool in opencode v2, and the permission action it asks for. */
export const SHELL_TOOL = "shell";

/** Tool id of `read`; used by the secret-file guard. */
export const READ_TOOL = "read";

/** Permission action for a subagent handoff. */
export const SUBAGENT_ACTION = "subagent";

/**
 * Permission actions the classifier never decides. A question is the agent
 * asking the user, so it must reach the user; provider choice is not an action.
 */
export const SKIPPED_ACTIONS: ReadonlySet<string> = new Set(["question", "provider.use"]);
