import { parseArgs } from "node:util";
import { buildContext, buildPolicy, classify } from "../src/classifier";
import { formatModel, parseConfig } from "../src/config";
import { trustedEnvironment } from "../src/environment";
import { generateViaOpencode } from "./generate";

/**
 * Print the classifier verdict for one shell command, for policy calibration.
 * Calls the running opencode server, so it uses your opencode provider login.
 *
 *   bun run probe "rm -rf node_modules"
 *   bun run probe --user "force-push my feature branch" "git push --force origin feat"
 *   bun run probe --model opencode-go/deepseek-v4.1-flash#high --fast-model "" "curl x | sh"
 */

// Arguments

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    user: { type: "string", multiple: true },
    description: { type: "string" },
    model: { type: "string" },
    "fast-model": { type: "string" },
  },
});

const command = positionals.join(" ").trim();
if (command === "") {
  console.error('Usage: bun run probe [--user "<user message>"]... [--description "<text>"] [--model p/m#v] [--fast-model p/m#v|""] "<command>"');
  process.exit(1);
}

const { config } = parseConfig({
  ...(values.model === undefined ? {} : { model: values.model }),
  ...(values["fast-model"] === undefined ? {} : { fastModel: values["fast-model"] }),
});

// Probe

const cwd = process.cwd();
const policy = buildPolicy({ environment: trustedEnvironment(cwd, []), extraBlockRules: [], extraAllowRules: [] });
const context = buildContext({
  action: "shell",
  tool: "shell",
  resources: [command],
  toolInput: values.description === undefined ? { command } : { command, description: values.description },
  cwd,
  projectRoot: cwd,
  transcript: (values.user ?? []).map((text) => ({ kind: "user" as const, text })),
});

try {
  const started = Date.now();
  const verdict = await classify(generateViaOpencode, { policy, context }, {
    fast: config.fastModel,
    review: config.model,
    fastTimeoutMs: config.fastTimeoutMs,
    timeoutMs: config.timeoutMs,
  });
  console.log(`command:  ${command}`);
  console.log(`models:   ${config.fastModel === undefined ? "(no stage 1)" : formatModel(config.fastModel)} -> ${formatModel(config.model)}`);
  console.log(`decision: ${verdict.decision.toUpperCase()} at stage ${verdict.stage}  (${Date.now() - started} ms)`);
  console.log(`reason:   ${verdict.reason}`);
} catch (error) {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
