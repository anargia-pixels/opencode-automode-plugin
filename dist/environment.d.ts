/**
 * The trusted environment for the policy: the project directory, its git
 * remotes, and what the user adds. By default nothing else is trusted, so
 * anything outside counts as a potential exfiltration target.
 */
export declare function trustedEnvironment(projectRoot: string, extra: readonly string[]): string[];
/** Remotes from the repository's git config, found from the project root upward. */
export declare function gitRemotes(projectRoot: string): {
    name: string;
    url: string;
}[];
/**
 * Current contents of files the agent wrote this session that a shell
 * command may run: files the command names, test files for a test runner,
 * and build files such as package.json for a script runner. The classifier
 * then judges the payload, not just `bun test`.
 */
export declare function agentFilesForCommand(command: string, writtenFiles: readonly string[], cwd: string, projectRoot: string): {
    path: string;
    content: string;
}[];
