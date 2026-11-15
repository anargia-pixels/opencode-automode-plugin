import type { Verdict } from "./classifier";
/** Shorten a command for error messages and logs. */
export declare function truncateCommand(command: string, maxChars?: number): string;
/**
 * Denial text for a blocked command. The model reads this, so it states what
 * happened, why, and how to proceed. After repeated blocks it tells the model
 * to stop retrying and hand the action to the user.
 */
export declare function formatBlockError(verdict: Verdict, command: string, isEscalated: boolean): string;
/**
 * Error text thrown when the guard refuses to read a secret file. The model
 * reads this, so it explains why and what to do instead.
 */
export declare function formatSecretFileError(filePath: string): string;
/** Denial text when the classifier cannot run and failOpen is false. */
export declare function formatUnavailableError(reason: string): string;
/**
 * System prompt note added while the plugin runs. It sets the auto mode
 * contract before anything is blocked, so a denial leads to a proper fix
 * instead of an ended turn or a workaround.
 */
export declare const AUTO_MODE_SYSTEM_NOTE: string;
