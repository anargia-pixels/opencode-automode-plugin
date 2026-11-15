/** True when the value is a plain record of unknown values. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Read a non-empty string field from a record, or `undefined`. */
export declare function readStringField(source: Record<string, unknown>, key: string): string | undefined;
