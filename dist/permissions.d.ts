/** Tool id of the shell tool in opencode v2, and the permission action it asks for. */
export declare const SHELL_TOOL = "shell";
/** Tool id of `read`; used by the secret-file guard. */
export declare const READ_TOOL = "read";
/** Permission action for a subagent handoff. */
export declare const SUBAGENT_ACTION = "subagent";
/**
 * Permission actions the classifier never decides. A question is the agent
 * asking the user, so it must reach the user; provider choice is not an action.
 */
export declare const SKIPPED_ACTIONS: ReadonlySet<string>;
