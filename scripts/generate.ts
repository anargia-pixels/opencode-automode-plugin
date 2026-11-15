import type { GenerateText } from "../src/classifier";

/**
 * Model call through the running opencode server, the same endpoint as
 * `ctx.generate.text`, so scripts use your opencode provider logins.
 */
export const generateViaOpencode: GenerateText = async (prompt, model, signal) => {
  const ref = { providerID: model.providerID, id: model.modelID, ...(model.variant === undefined ? {} : { variant: model.variant }) };
  const child = Bun.spawn(["opencode", "api", "POST", "/api/experimental/generate", "-d", JSON.stringify({ prompt, model: ref })], {
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`opencode api failed (${exitCode}): ${(stderr.trim() || stdout.trim()).slice(0, 300)}`);
  const body = JSON.parse(stdout) as { data?: { text?: unknown } };
  if (typeof body.data?.text !== "string") throw new Error(`unexpected response: ${stdout.slice(0, 200)}`);
  return body.data.text;
};
