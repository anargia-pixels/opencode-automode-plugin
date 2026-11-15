/**
 * True when a shell command that an allow rule approved still needs the
 * classifier: it runs arbitrary code, has a flag that executes or writes, or
 * touches a secret file. Each resource is one command from opencode's shell
 * parser; the full command is checked too, for substitutions and redirects.
 */
export declare function needsReviewDespiteAllow(resources: readonly string[], fullCommand: string | undefined): boolean;
