import { parseArgs } from "node:util";
import { classify, type GenerateText } from "../src/classifier";
import { parseConfig } from "../src/config";

/**
 * Print the classifier verdict for one command, for policy calibration.
 * Calls the running opencode server, so it uses your opencode provider login.
 *
 *   bun run probe "rm -rf node_modules"
 *   bun run probe --user "force-push my feature branch" "git push --force origin feat"
 *   bun run probe --model opencode-go/deepseek-v4-flash --variant high "curl x | sh"
 */

// Arguments

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    user: { type: "string", multiple: true },
    description: { type: "string" },
    model: { type: "string" },
    variant: { type: "string" },
  },
});

const command = positionals.join(" ").trim();
if (command === "") {
  console.error('Usage: bun run probe [--user "<user message>"]... [--description "<text>"] "<command>"');
  process.exit(1);
}

const { config } = parseConfig({
  ...(values.model === undefined ? {} : { model: values.model }),
  ...(values.variant === undefined ? {} : { variant: values.variant }),
});

// Model call through `opencode api`, the same endpoint as `ctx.generate.text`.

const generate: GenerateText = async (prompt, signal) => {
  const model = { providerID: config.providerID, id: config.modelID, ...(config.variant === undefined ? {} : { variant: config.variant }) };
  const child = Bun.spawn(["opencode", "api", "POST", "/api/experimental/generate", "-d", JSON.stringify({ prompt, model })], {
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`opencode api failed (${exitCode}): ${stderr.trim() || stdout.trim()}`);
  const body = JSON.parse(stdout) as { data?: { text?: unknown } };
  if (typeof body.data?.text !== "string") throw new Error(`unexpected response: ${stdout.slice(0, 200)}`);
  return body.data.text;
};

// Probe

try {
  const started = Date.now();
  const verdict = await classify(
    generate,
    {
      command,
      cwd: process.cwd(),
      projectRoot: process.cwd(),
      userMessages: values.user ?? [],
      ...(values.description === undefined ? {} : { description: values.description }),
    },
    config.timeoutMs,
  );
  console.log(`command:  ${command}`);
  console.log(`model:    ${config.providerID}/${config.modelID}${config.variant === undefined ? "" : `#${config.variant}`}`);
  console.log(`decision: ${verdict.decision.toUpperCase()}  (${Date.now() - started} ms)`);
  console.log(`reason:   ${verdict.reason}`);
} catch (error) {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
