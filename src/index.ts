import type { Plugin } from "@opencode/plugin";
import { buildContext, buildPolicy, classify, type ActionInput, type GenerateText } from "./classifier";
import { formatModel, parseConfig } from "./config";
import { ContextTracker } from "./context";
import { agentFilesForCommand, trustedEnvironment } from "./environment";
import { Evaluator, type EvaluationResult } from "./evaluator";
import { isRecord, readStringField } from "./guards";
import { detectInjection, resultText, withWarning } from "./injection";
import { createLog } from "./log";
import {
  AUTO_MODE_SYSTEM_NOTE,
  formatBlockError,
  formatInjectionWarning,
  formatPausedError,
  formatSecretFileError,
  formatUnavailableError,
  truncateCommand,
} from "./messages";
import { READ_TOOL, SHELL_TOOL, SKIPPED_ACTIONS, SUBAGENT_ACTION } from "./permissions";
import { needsReviewDespiteAllow } from "./rules";
import { isSensitiveFilePath } from "./sensitive";

// Types

interface SessionCounters {
  consecutive: number;
  total: number;
}

// Global constants

/** How long a verdict for one tool call is reused for its other permission asks. */
const CALL_VERDICT_TTL_MS = 60_000;
/** Deepest parent chain followed to find a subagent's root session. */
const MAX_SESSION_DEPTH = 8;

// Plugin

/**
 * OpenCode plugin that hands permission asks to an LLM classifier, after the
 * design of Claude Code's auto mode:
 *
 * - Tier 1: read-only tools and your allow rules run as before, except allowed
 *   shell commands that can run arbitrary code, which go to the classifier.
 * - Tier 2: edits inside the project follow your rules (allowed by default).
 * - Tier 3: every action your rules leave at `ask` goes to the
 *   classifier that sees your messages and the agent's tool calls, but no
 *   assistant prose and no tool results.
 *
 * Tool output that looks like a prompt injection gets a warning first. A
 * block returns a reason and tells the agent to find a safer route. After
 * repeated blocks the agent is told to stop, and after many the session
 * pauses until you write again.
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
    const counters = new Map<string, SessionCounters>();
    const callVerdicts = new Map<string, { sessionID: string; result: EvaluationResult; at: number }>();
    const rootSessions = new Map<string, string | undefined>();

    const policy = buildPolicy({
      environment: trustedEnvironment(projectRoot, config.trustedEnvironment),
      extraBlockRules: config.blockRules,
      extraAllowRules: config.allowRules,
    });

    const generate: GenerateText = async (prompt, model, signal) => {
      const ref = { providerID: model.providerID, id: model.modelID, ...(model.variant === undefined ? {} : { variant: model.variant }) };
      const { text } = await ctx.generate.text({ prompt, model: ref }, { signal });
      return text;
    };
    const evaluator = new Evaluator(
      (actionContext) =>
        classify(generate, { policy, context: actionContext }, {
          fast: config.fastModel,
          review: config.model,
          fastTimeoutMs: config.fastTimeoutMs,
          timeoutMs: config.timeoutMs,
        }),
      { cacheTtlMs: config.cacheTtlMs, maxCacheEntries: config.maxCacheEntries },
    );

    log("info", "Auto mode command guard active", {
      fastModel: config.fastModel === undefined ? "off" : formatModel(config.fastModel),
      model: formatModel(config.model),
      failOpen: config.failOpen,
      reviewAllowedCode: config.reviewAllowedCode,
      injectionProbe: config.injectionProbe,
    });
    for (const warning of warnings) log("warn", `Auto mode config: ${warning}`);

    const countersFor = (sessionID: string): SessionCounters => {
      let entry = counters.get(sessionID);
      if (entry === undefined) {
        entry = { consecutive: 0, total: 0 };
        counters.set(sessionID, entry);
      }
      return entry;
    };

    /** The root session of a subagent, or `undefined` for a top-level session. */
    const rootSessionOf = async (sessionID: string): Promise<string | undefined> => {
      if (rootSessions.has(sessionID)) return rootSessions.get(sessionID);
      let root: string | undefined;
      let current = sessionID;
      try {
        for (let depth = 0; depth < MAX_SESSION_DEPTH; depth += 1) {
          const info: unknown = await ctx.session.get({ sessionID: current });
          const parent = isRecord(info) ? readStringField(info, "parentID") : undefined;
          if (parent === undefined) break;
          root = parent;
          current = parent;
        }
      } catch {
        // Unknown session shape: treat it as top-level.
      }
      rootSessions.set(sessionID, root);
      return root;
    };

    // Keep the transcript: user messages and agent tool calls. A new user
    // message hands control back, so the block counters reset.
    await ctx.session.hook("context", (event) => {
      if (context.updateFromMessages(event.sessionID, event.messages)) counters.delete(event.sessionID);
      if (config.continueOnDeny) event.system.push({ type: "text", text: AUTO_MODE_SYSTEM_NOTE });
    });

    // Record each tool call's input, and refuse reads of known secret files
    // before they reach the model.
    await ctx.tool.hook("execute.before", async (event) => {
      context.recordToolCall(event.sessionID, event.id, event.tool, event.input);
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

    // Input-layer probe: warn the agent about tool output that addresses it.
    await ctx.tool.hook("execute.after", (event) => {
      if (!config.injectionProbe || event.status !== "completed") return;
      const content = event.result.content;
      const match = detectInjection(event.tool, resultText(content));
      if (match === undefined) return;
      context.recordSuspicion(event.sessionID, `${event.tool}: ${match}`);
      log("warn", "Injection probe flagged tool output", { tool: event.tool, match });
      if (content !== undefined) event.result = { ...event.result, content: withWarning(content, formatInjectionWarning(event.tool, match)) as typeof content };
    });

    // Output layer: classify permission asks.
    await ctx.permission.hook("evaluate", async (event) => {
      if (SKIPPED_ACTIONS.has(event.action) || event.effect === "deny") return;
      const callID = event.source?.id;
      const call = context.toolCallFor(callID);
      const callInput = call?.sessionID === event.sessionID ? call.input : undefined;

      if (event.effect === "allow") {
        // Tier 1: allow rules stand, except shell commands that can run arbitrary code.
        if (!config.reviewAllowedCode || event.action !== SHELL_TOOL) return;
        const command = isRecord(callInput) ? readStringField(callInput, "command") : undefined;
        if (!needsReviewDespiteAllow(event.resources, command)) return;
      } else if (event.effect !== "ask") {
        return;
      }

      const sessionCounters = countersFor(event.sessionID);
      if (sessionCounters.total >= config.maxTotalDenials) {
        event.effect = "deny";
        event.message = formatPausedError(sessionCounters.total);
        return;
      }

      // One tool call can ask several times (outside directory, then shell).
      // The classifier judged the whole call, so its verdict covers each ask.
      const actionText = describeAction(event.action, event.resources, callInput);
      const previous = callID === undefined ? undefined : callVerdicts.get(callID);
      let result: EvaluationResult;
      let elapsedMs = 0;
      if (previous !== undefined && previous.sessionID === event.sessionID && Date.now() - previous.at < CALL_VERDICT_TTL_MS) {
        result = previous.result;
      } else {
        const input = await buildInput(event.sessionID, event.action, event.resources, call?.tool, callInput, callID);
        const started = Date.now();
        result = await evaluator.evaluate(buildContext(input));
        elapsedMs = Date.now() - started;
        if (callID !== undefined && result.ok) {
          callVerdicts.set(callID, { sessionID: event.sessionID, result, at: Date.now() });
          pruneCallVerdicts(callVerdicts);
        }
      }

      if (!result.ok) {
        if (config.failOpen) {
          // Never approve without a verdict: the normal ask stays.
          log("warn", `Classifier failed; leaving the ask to opencode: ${result.error}`, { action: event.action, target: truncateCommand(actionText) });
          if (event.effect === "allow") event.effect = "ask";
          return;
        }
        log("error", `Classifier failed; denying: ${result.error}`, { action: event.action, target: truncateCommand(actionText) });
        event.effect = "deny";
        event.message = formatUnavailableError(result.error);
        return;
      }

      const { verdict } = result;
      const details = {
        action: event.action,
        command: truncateCommand(actionText),
        stage: verdict.stage,
        ...(verdict.fastFilter === undefined ? {} : { fastFilter: verdict.fastFilter }),
        reason: verdict.reason,
        elapsedMs,
      };
      if (verdict.decision === "allow") {
        sessionCounters.consecutive = 0;
        log("info", "Auto mode approved an action", details);
        event.effect = "allow";
        return;
      }

      context.recordBlock(event.sessionID, `${event.action}: ${actionText}`);
      sessionCounters.consecutive += 1;
      sessionCounters.total += 1;
      log("warn", "Auto mode blocked an action", {
        ...details,
        consecutiveDenials: sessionCounters.consecutive,
        totalDenials: sessionCounters.total,
      });
      event.effect = "deny";
      event.message = formatBlockError(verdict, actionText, sessionCounters.consecutive >= config.maxConsecutiveDenials);
    });

    /** Gather everything the classifier sees for one ask. */
    async function buildInput(
      sessionID: string,
      action: string,
      resources: readonly string[],
      tool: string | undefined,
      toolInput: unknown,
      callID: string | undefined,
    ): Promise<ActionInput> {
      const root = await rootSessionOf(sessionID);
      const cwd = (isRecord(toolInput) ? readStringField(toolInput, "workdir") ?? readStringField(toolInput, "cwd") : undefined) ?? projectRoot;
      const command =
        action !== SHELL_TOOL ? undefined : (isRecord(toolInput) ? readStringField(toolInput, "command") : undefined) ?? resources.join("\n");
      const agentFiles =
        command === undefined ? [] : agentFilesForCommand(command, context.writtenFilesFor(sessionID), cwd, projectRoot);
      const blocks = context.recentBlocksFor(sessionID);
      const suspicions = context.suspicionsFor(sessionID);
      const rootUserMessages = root === undefined ? undefined : context.userMessagesFor(root);
      return {
        action,
        ...(tool === undefined ? {} : { tool }),
        resources,
        ...(toolInput === undefined ? {} : { toolInput }),
        cwd,
        projectRoot,
        transcript: context.transcriptFor(sessionID, callID),
        ...(rootUserMessages === undefined ? {} : { rootUserMessages }),
        ...(blocks.length === 0 ? {} : { recentBlocks: blocks }),
        ...(suspicions.length === 0 ? {} : { suspicions }),
        ...(agentFiles.length === 0 ? {} : { agentFiles }),
      };
    }
  },
};

export default AutomodePlugin;

// Helpers

/** Short text for one action, for logs and the block message. */
function describeAction(action: string, resources: readonly string[], toolInput: unknown): string {
  if (isRecord(toolInput)) {
    const command = readStringField(toolInput, "command");
    if (command !== undefined) return command;
    if (action === SUBAGENT_ACTION) {
      const prompt = readStringField(toolInput, "prompt") ?? readStringField(toolInput, "description");
      if (prompt !== undefined) return `${resources.join(", ")}: ${prompt}`;
    }
  }
  return resources.length > 0 ? resources.join("\n") : action;
}

/** Drop call verdicts older than their reuse window. */
function pruneCallVerdicts(verdicts: Map<string, { at: number }>): void {
  if (verdicts.size < 200) return;
  const cutoff = Date.now() - CALL_VERDICT_TTL_MS;
  for (const [id, entry] of verdicts) if (entry.at < cutoff) verdicts.delete(id);
}
