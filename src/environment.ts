import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSensitiveFilePath } from "./sensitive";

// Global constants

/** Most agent-written files attached to one action. */
const MAX_AGENT_FILES = 3;
/** Largest file read for the classifier, in bytes. */
const MAX_AGENT_FILE_BYTES = 64 * 1024;

const TEST_RUNNER = /\b(test|tests|vitest|jest|mocha|pytest|unittest|rspec|phpunit|ctest|tap)\b/;
const SCRIPT_RUNNER = /\b(npm|pnpm|yarn|bun|deno|make|just|task|rake|cargo|go|poetry|uv|tox|nox)\b/;
const BUILD_FILES = new Set(["package.json", "makefile", "justfile", "taskfile.yml", "rakefile", "pyproject.toml", "setup.py", "cargo.toml", "build.rs", "tox.ini", "noxfile.py", "bunfig.toml", "deno.json", "conftest.py"]);

// Environment

/**
 * The trusted environment for the policy: the project directory, its git
 * remotes, and what the user adds. By default nothing else is trusted, so
 * anything outside counts as a potential exfiltration target.
 */
export function trustedEnvironment(projectRoot: string, extra: readonly string[]): string[] {
  const items = [`The project directory ${projectRoot} and the local machine's temp directories`];
  for (const remote of gitRemotes(projectRoot)) items.push(`Git remote ${remote.name}: ${remote.url}`);
  items.push("Package registries the project already uses, for installing its declared dependencies");
  for (const item of extra) items.push(item);
  return items;
}

/** Remotes from the repository's git config, found from the project root upward. */
export function gitRemotes(projectRoot: string): { name: string; url: string }[] {
  const config = findGitConfig(projectRoot);
  if (config === undefined) return [];
  let text: string;
  try {
    text = readFileSync(config, "utf8");
  } catch {
    return [];
  }
  const remotes: { name: string; url: string }[] = [];
  let current: string | undefined;
  for (const line of text.split("\n")) {
    const section = /^\s*\[remote\s+"([^"]+)"\]/.exec(line);
    if (section !== null) {
      current = section[1];
      continue;
    }
    if (/^\s*\[/.test(line)) current = undefined;
    const url = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
    if (current !== undefined && url?.[1] !== undefined) remotes.push({ name: current, url: stripCredentials(url[1]) });
  }
  return remotes;
}

function findGitConfig(start: string): string | undefined {
  let directory = resolve(start);
  for (let depth = 0; depth < 20; depth += 1) {
    const dotGit = join(directory, ".git");
    if (existsSync(dotGit)) {
      try {
        if (statSync(dotGit).isDirectory()) return join(dotGit, "config");
        // A worktree or submodule: `.git` is a file pointing at the git dir.
        const pointer = /gitdir:\s*(.+)/.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
        if (pointer === undefined) return undefined;
        const gitDir = isAbsolute(pointer) ? pointer : resolve(directory, pointer);
        const common = join(gitDir, "commondir");
        const base = existsSync(common) ? resolve(gitDir, readFileSync(common, "utf8").trim()) : gitDir;
        return join(base, "config");
      } catch {
        return undefined;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return undefined;
}

/** Remove `user:token@` from a remote URL before it goes in a prompt. */
function stripCredentials(url: string): string {
  return url.replace(/^(\w+:\/\/)[^@/]+@/, "$1");
}

// Payloads

/**
 * Current contents of files the agent wrote this session that a shell
 * command may run: files the command names, test files for a test runner,
 * and build files such as package.json for a script runner. The classifier
 * then judges the payload, not just `bun test`.
 */
export function agentFilesForCommand(
  command: string,
  writtenFiles: readonly string[],
  cwd: string,
  projectRoot: string,
): { path: string; content: string }[] {
  const lowered = command.toLowerCase();
  const isTestRun = TEST_RUNNER.test(lowered);
  const isScriptRun = SCRIPT_RUNNER.test(lowered);
  const picked: { path: string; content: string }[] = [];
  // Newest writes first: they are the most likely payload.
  for (const path of [...writtenFiles].reverse()) {
    if (picked.length >= MAX_AGENT_FILES) break;
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    const name = basename(absolute).toLowerCase();
    const shown = relative(projectRoot, absolute);
    const isNamed = lowered.includes(name) || lowered.includes(shown.toLowerCase());
    const isTest = isTestRun && /(\.|_|-|\/)(test|spec)s?(\.|_|\/)|^test_|\/tests?\//.test(`/${shown.toLowerCase()}`);
    const isBuild = isScriptRun && BUILD_FILES.has(name);
    if (!isNamed && !isTest && !isBuild) continue;
    if (isSensitiveFilePath(absolute)) continue;
    const content = readSmallFile(absolute);
    if (content !== undefined) picked.push({ path: shown.startsWith("..") ? absolute : shown, content });
  }
  return picked;
}

function readSmallFile(path: string): string | undefined {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return undefined;
    const content = readFileSync(path, "utf8");
    return content.length > MAX_AGENT_FILE_BYTES ? content.slice(0, MAX_AGENT_FILE_BYTES) : content;
  } catch {
    return undefined;
  }
}
