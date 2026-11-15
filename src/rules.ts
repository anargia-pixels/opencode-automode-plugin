import { isSensitiveFilePath } from "./sensitive";

// Global constants

/**
 * Programs that run code given to them: interpreters, shells, and wrappers
 * that run another command. An allow rule such as `python *` or `bun *`
 * grants arbitrary code execution, so Claude Code drops such rules in auto
 * mode; this plugin sends the commands to the classifier instead.
 */
const CODE_RUNNERS = new Set([
  "python", "python2", "python3", "node", "nodejs", "bun", "deno", "ruby", "perl", "php", "lua", "luajit", "julia", "rscript",
  "osascript", "pwsh", "powershell", "tclsh", "wish", "expect",
  "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "nu", "busybox",
  "eval", "exec", "source", ".", "xargs", "env", "nohup", "timeout", "nice", "ionice", "stdbuf", "time", "watch", "parallel",
  "strace", "ltrace", "gdb", "script", "flock", "setsid", "chroot", "unshare", "nsenter", "systemd-run", "at", "batch", "crontab",
  "npx", "bunx", "pnpx", "uvx", "pipx", "tsx", "ts-node", "vite-node", "make", "just", "task", "rake", "gradle", "gradlew", "./gradlew", "mvn",
  "docker", "podman", "kubectl", "ssh", "sudo", "su", "doas", "pkexec",
]);

/** Package manager subcommands that run project or downloaded code. */
const PACKAGE_RUNNERS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(["run", "run-script", "exec", "x", "test", "t", "start", "stop", "restart", "install", "i", "ci", "add", "rebuild", "explore"]),
  pnpm: new Set(["run", "exec", "dlx", "test", "t", "start", "install", "i", "add", "rebuild", "create"]),
  yarn: new Set(["run", "exec", "dlx", "test", "start", "install", "add", "create", "node"]),
  uv: new Set(["run", "tool", "pip"]),
  pip: new Set(["install"]),
  pip3: new Set(["install"]),
  poetry: new Set(["run", "install", "add"]),
  cargo: new Set(["run", "test", "build", "install", "bench"]),
  go: new Set(["run", "test", "generate", "build", "install"]),
  git: new Set(["-c", "--config-env", "submodule", "filter-branch", "bisect"]),
};

/** Flags that turn a read-only looking tool into one that runs or writes. */
const RISKY_FLAGS: Readonly<Record<string, RegExp>> = {
  find: /(^|\s)-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)(\s|$)/,
  sed: /(^|\s)(-i|--in-place|-[a-zA-Z]*i)|\/e(\s|'|"|$)|(^|[;'"\s])e\s|(^|[;'"\s])w\s/,
  awk: /system\s*\(|\|\s*"|getline|print[^;]*>/,
  gawk: /system\s*\(|\|\s*"|getline|print[^;]*>/,
  sort: /(^|\s)(-o|--output)/,
  tar: /--to-command|--checkpoint-action|--use-compress-program|(^|\s)-I(\s|$)/,
  rsync: /(^|\s)(-e|--rsh)(\s|=|$)/,
  less: /.*/, // `!` runs a shell from inside less
  vi: /.*/,
  vim: /.*/,
  nvim: /.*/,
  emacs: /.*/,
};

// Check

/**
 * True when a shell command that an allow rule approved still needs the
 * classifier: it runs arbitrary code, has a flag that executes or writes, or
 * touches a secret file. Each resource is one command from opencode's shell
 * parser; the full command is checked too, for substitutions and redirects.
 */
export function needsReviewDespiteAllow(resources: readonly string[], fullCommand: string | undefined): boolean {
  const commands = resources.length > 0 ? resources : fullCommand === undefined ? [] : [fullCommand];
  for (const command of commands) {
    const words = splitWords(command);
    const program = programName(words[0]);
    if (program === undefined) continue;
    // A path such as `./build.sh` runs a local script or binary.
    if (stripQuotes(words[0] ?? "").includes("/")) return true;
    if (CODE_RUNNERS.has(program)) return true;
    const subcommand = words[1];
    if (subcommand !== undefined && PACKAGE_RUNNERS[program]?.has(subcommand)) return true;
    const risky = RISKY_FLAGS[program];
    if (risky !== undefined && risky.test(words.slice(1).join(" "))) return true;
    if (words.some((word) => isSensitiveFilePath(stripQuotes(word)))) return true;
  }
  if (fullCommand !== undefined) {
    // Command substitution, process substitution, or a redirect into a file can hide work.
    if (/\$\(|`|<\(|>\(/.test(fullCommand)) return true;
    if (/(^|[^0-9&>])>{1,2}\s*(?!\/dev\/null\b)[^\s&|]/.test(fullCommand)) return true;
  }
  return false;
}

// Helpers

/** Split a command into words, keeping quoted parts together. Good enough for a first-word check. */
function splitWords(command: string): string[] {
  return command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

/** The program a command runs, without a directory or leading env assignments. */
function programName(word: string | undefined): string | undefined {
  if (word === undefined) return undefined;
  const bare = stripQuotes(word);
  // `FOO=1 cmd` is an env assignment; treat it as code that could change the command.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(bare)) return "env";
  if (bare.startsWith("./gradlew")) return "./gradlew";
  const slash = bare.lastIndexOf("/");
  return (slash === -1 ? bare : bare.slice(slash + 1)).toLowerCase();
}

function stripQuotes(word: string): string {
  return word.replace(/^["']|["']$/g, "");
}
