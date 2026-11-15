/**
 * True when a path names a secret file the guard refuses to read.
 *
 * The check is deterministic: known secret files never need a model judgment,
 * and their contents must not be sent to a third-party API.
 */
export declare function isSensitiveFilePath(filePath: string): boolean;
