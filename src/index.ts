import type { Plugin } from "@opencode/plugin";
import { classify, type CommandInput, type GenerateText } from "./classifier";
import { parseConfig } from "./config";
import { ContextTracker } from "./context";
import { CommandEvaluator } from "./evaluator";
import { isRecord, readStringField } from "./guards";
import { createLog } from "./log";
import {
  AUTO_MODE_SYSTEM_NOTE,
  formatBlockError,
  formatSecretFileError,
  formatUnavailableError,
  truncateCommand,
} from "./messages";
import { READ_TOOL, SHELL_TOOL } from "./permissions";
import { isSensitiveFilePath } from "./sensitive";

// Plugin

/**
 * OpenCode plugin that gives shell permission asks to a fast LLM classifier.
 *
 * Only shell commands that opencode's rules leave at `ask` are classified;
 * commands the config already allows or denies are untouched. A safe verdict
 * approves the ask with no prompt. A block denies it with a reason, and the
 * model is told to find a safer route instead of stopping. The classifier
 * sees recent user messages, the working directory, and the agent's own
 * description of the command, so it can judge the command against the task.
 *
 * The plugin is a plain object typed as `Plugin.Plugin`; `Plugin.define` only
 * returns its argument, so the published bundle needs no runtime dependency.
 */
export const AutomodePlugin: Plugin.Plugin = {
  id: "opencode-automode",

  async setup(ctx) {
    const { config, warnings } = parseConfig(ctx.options);
    const log = createLog("opencode-automode", config.logFile);
    const projectRoot = ctx.location.directory === "" ? ctx.location.project.canonical : ctx.location.directory;
    const context = new ContextTracker();
    const consecutiveDenials = new Map<string, number>();

    const generate: GenerateText = async (prompt, signal) => {
      const model = {
        providerID: config.providerID,
        id: config.modelID,
        ...(config.variant === undefined ? {} : { variant: config.variant }),
      };
      const { text } = await ctx.generate.text({ prompt, model }, { signal });
      return text;
    };
    const evaluator = new CommandEvaluator((input) => classify(generate, input, config.timeoutMs), {
      cacheTtlMs: config.cacheTtlMs,
      maxCacheEntries: config.maxCacheEntries,
    });

    log("info", "Auto mode command guard active", {
      model: `${config.providerID}/${config.modelID}`,
      variant: config.variant ?? "default",
      failOpen: config.failOpen,
      continueOnDeny: config.continueOnDeny,
    });
    for (const warning of warnings) log("warn", `Auto mode config: ${warning}`);

    // Keep the latest user messages; they are the classifier's view of intent.
    await ctx.session.hook("context", (event) => {
      context.updateFromMessages(event.sessionID, event.messages);
      if (config.continueOnDeny) event.system.push({ type: "text", text: AUTO_MODE_SYSTEM_NOTE });
    });

    // Remember each shell call's description and directory, and refuse reads
    // of known secret files before they reach the model.
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool === SHELL_TOOL) context.recordShellCall(event.id, event.input);
      if (config.protectSecretFiles && event.tool === READ_TOOL) {
        const filePath = isRecord(event.input)
          ? readStringField(event.input, "path") ?? readStringField(event.input, "filePath")
          : undefined;
        if (filePath !== undefined && isSensitiveFilePath(filePath)) {
          log("warn", "Secret-file guard blocked a read", { filePath: truncateCommand(filePath) });
          throw new Error(formatSecretFileError(filePath));
        }
      }
    });

    // Classify shell asks. Rules that already allow or deny are left alone.
    await ctx.permission.hook("evaluate", async (event) => {
      if (event.action !== SHELL_TOOL || event.effect !== "ask" || event.resources.length === 0) return;

      const call = context.shellCallFor(event.source?.id);
      const input: CommandInput = {
        // The full tool command shows how parts connect; the resources are the
        // scanner's split, used when the call is unknown.
        command: call?.command ?? event.resources.join("\n"),
        cwd: call?.cwd ?? projectRoot,
        projectRoot,
        userMessages: context.userMessagesFor(event.sessionID),
        recentBlocks: context.recentBlocksFor(event.sessionID),
        ...(call?.description === undefined ? {} : { description: call.description }),
      };

      const started = Date.now();
      const result = await evaluator.evaluate(input);
      const elapsedMs = Date.now() - started;

      if (!result.ok) {
        if (config.failOpen) {
          // Never approve without a verdict: the normal ask stays.
          log("warn", `Classifier failed; leaving the ask to opencode: ${result.error}`, { command: truncateCommand(input.command) });
          return;
        }
        event.effect = "deny";
        event.message = formatUnavailableError(result.error);
        return;
      }

      const { verdict } = result;
      if (verdict.decision === "allow") {
        consecutiveDenials.delete(event.sessionID);
        log("info", "Auto mode approved a command", { command: truncateCommand(input.command), reason: verdict.reason, elapsedMs });
        event.effect = "allow";
        return;
      }

      context.recordBlock(event.sessionID, input.command);
      const denials = (consecutiveDenials.get(event.sessionID) ?? 0) + 1;
      consecutiveDenials.set(event.sessionID, denials);
      log("warn", "Auto mode blocked a command", {
        command: truncateCommand(input.command),
        reason: verdict.reason,
        consecutiveDenials: denials,
        elapsedMs,
      });
      event.effect = "deny";
      event.message = formatBlockError(verdict, input.command, denials >= config.maxConsecutiveDenials);
    });
  },
};

export default AutomodePlugin;
