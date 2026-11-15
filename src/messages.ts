import type { Verdict } from "./classifier";

// Global constants

/** Longest command shown in an error or a log entry. */
const MAX_COMMAND_CHARS = 600;

/**
 * Closing guidance on every guard error. In auto mode nobody may be watching,
 * so the model keeps working toward the goal by a legitimate route instead of
 * ending the turn or slipping past the guard.
 */
const KEEP_WORKING_GUIDANCE = [
  "Do not stop here, and do not try to get around this guard: no rewording, encoding, splitting, scripting, running a blocked script's steps by hand, or using another tool to do the same thing.",
  "Work out what you actually need and reach it a safer way, such as a narrower command, a read-only check, a project script, or an edit in the workspace.",
  "If the task truly needs this exact action, finish everything else you can, then tell the user what to run or approve themselves and why.",
].join(" ");

/** Guidance after several blocks in a row: stop probing the guard. */
const ESCALATION_GUIDANCE = [
  "Several commands in a row were blocked. Stop trying shell variations of this action.",
  "Finish any remaining work that does not need it, then tell the user exactly which command is blocked, why you need it, and ask them to run or approve it.",
].join(" ");

// Formatters

/** Shorten a command for error messages and logs. */
export function truncateCommand(command: string, maxChars: number = MAX_COMMAND_CHARS): string {
  if (command.length <= maxChars) return command;
  return `${command.slice(0, maxChars)}… (${command.length - maxChars} more characters)`;
}

/** Indent each line by two spaces. */
function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/**
 * Denial text for a blocked command. The model reads this, so it states what
 * happened, why, and how to proceed. After repeated blocks it tells the model
 * to stop retrying and hand the action to the user.
 */
export function formatBlockError(verdict: Verdict, command: string, isEscalated: boolean): string {
  return [
    "Auto mode safety classifier blocked this command. Nothing ran.",
    "",
    "Command:",
    indent(truncateCommand(command)),
    "",
    `Reason: ${verdict.reason}`,
    "",
    isEscalated ? ESCALATION_GUIDANCE : KEEP_WORKING_GUIDANCE,
  ].join("\n");
}

/**
 * Error text thrown when the guard refuses to read a secret file. The model
 * reads this, so it explains why and what to do instead.
 */
export function formatSecretFileError(filePath: string): string {
  return [
    "Blocked by the secret-file guard. The file was not read.",
    "",
    `File: ${truncateCommand(filePath)}`,
    "",
    "It can hold credentials, keys, or tokens. To learn which settings exist, read a non-secret example such as `.env.example` or the code that loads them.",
    "",
    KEEP_WORKING_GUIDANCE,
  ].join("\n");
}

/** Denial text when the classifier cannot run and failOpen is false. */
export function formatUnavailableError(reason: string): string {
  return [
    `Auto mode safety classifier could not check this command (${reason}). The command did not run.`,
    "",
    "You may retry the same command once. If it fails again, continue with tools that do not need shell, then tell the user which commands are still waiting to run.",
  ].join("\n");
}

// System prompt

/**
 * System prompt note added while the plugin runs. It sets the auto mode
 * contract before anything is blocked, so a denial leads to a proper fix
 * instead of an ended turn or a workaround.
 */
export const AUTO_MODE_SYSTEM_NOTE = [
  "Auto mode safety guard: a classifier checks tool calls and may block risky ones, and the user may reject a permission request.",
  "When a tool call is blocked, denied, or rejected, the turn is not over. Read the reason, then keep working toward the user's goal by a legitimate route.",
  "Never try to get around a block: do not reword, encode, split, or script the same action, do not run a blocked script's steps by hand, and do not switch tools to do it anyway.",
  "If the goal truly needs the blocked action, finish everything else, then tell the user exactly what to run or approve and why.",
].join("\n");
