// Global constants

/** Example files that intentionally contain no secrets. */
const ALLOWED_ENV_EXAMPLES = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);

/** File names that hold credentials or private keys. */
const SENSITIVE_NAMES = new Set([
  ".npmrc",
  ".netrc",
  ".pgpass",
  ".git-credentials",
  ".htpasswd",
  "credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

/** Suffixes of files that hold private keys or key stores. */
const SENSITIVE_SUFFIXES = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];

/** Directories whose contents are credential stores. */
const SENSITIVE_DIRECTORIES = new Set([".ssh", ".aws", ".gnupg", ".docker", ".kube"]);

// Check

/**
 * True when a path names a secret file the guard refuses to read.
 *
 * The check is deterministic: known secret files never need a model judgment,
 * and their contents must not be sent to a third-party API.
 */
export function isSensitiveFilePath(filePath: string): boolean {
  const segments = filePath
    .replaceAll("\\", "/")
    .toLowerCase()
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  const basename = segments.at(-1);
  if (basename === undefined) return false;
  if (ALLOWED_ENV_EXAMPLES.has(basename)) return false;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (SENSITIVE_NAMES.has(basename)) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => basename.endsWith(suffix))) return true;
  return segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment));
}
