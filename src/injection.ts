// Global constants

/**
 * Patterns of text that addresses the agent instead of describing data:
 * instruction overrides, fake system or chat turns, and requests to run,
 * send, or hide something. One match is enough for a warning; a false
 * positive costs only a short note in the tool output.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|system)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directives?)\b/i,
  /\b(new|updated|real|actual|hidden|secret)\s+(system\s+)?(instructions?|directives?|task)\s*:/i,
  /\byou\s+are\s+now\b[^.\n]{0,60}\b(assistant|agent|ai|mode|unrestricted|jailbroken|dan)\b/i,
  /<\/?\s*(system|system_prompt|instructions?|assistant|im_start|im_end)\s*>|<\|im_start\|>|<\|im_end\|>|\[\/?INST\]|<<SYS>>/i,
  /\b(note|message|attention|important|instructions?)\s+(to|for)\s+(the\s+)?(ai|llm|assistant|agent|claude|gpt|model|coding agent)s?\b/i,
  /\b(ai|llm|assistant|coding)\s+(agents?|assistants?|models?)\s+(must|should|need to|are required to|reading this)\b/i,
  /\bif\s+you\s+are\s+an?\s+(ai|llm|language model|assistant|agent)\b/i,
  /\b(do\s+not|don't|never)\s+(tell|inform|notify|alert|mention\s+(this\s+)?to)\s+(the\s+)?user\b/i,
  /\bwithout\s+(asking|telling|informing|notifying)\s+(the\s+)?user\b/i,
  /\b(run|execute|paste)\s+(the\s+following|this)\s+(command|script|code)\b[^\n]{0,80}(curl|wget|bash|sh\b|powershell|iex|base64)/i,
  /\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b/i,
  /\b(send|post|upload|exfiltrate|forward|leak)\b[^.\n]{0,60}\b(api[_ -]?keys?|tokens?|secrets?|credentials?|passwords?|\.env|ssh keys?|private keys?)\b/i,
  /\b(auto[- ]?approve|bypass|disable|turn off)\b[^.\n]{0,40}\b(safety|guard|classifier|permission|sandbox|auto ?mode)\b/i,
];

/** Longest tool output the probe scans; the head and tail are kept. */
const MAX_SCAN_CHARS = 200_000;

/** Tools whose output the agent wrote itself or that hold no outside content. */
const SKIPPED_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "patch", "todowrite", "todoread", "question", "plan_enter", "plan_exit"]);

// Probe

/**
 * The first pattern that matches the tool output, or `undefined`.
 *
 * Heuristic on purpose: it runs on every tool result, so it must cost no
 * model call. The transcript classifier never sees tool output, so the probe
 * only has to make the agent re-anchor on the user's request; the two layers
 * compound.
 */
export function detectInjection(tool: string, text: string): string | undefined {
  if (SKIPPED_TOOLS.has(tool) || text.length === 0) return undefined;
  const sample = text.length <= MAX_SCAN_CHARS ? text : `${text.slice(0, MAX_SCAN_CHARS / 2)}\n${text.slice(-MAX_SCAN_CHARS / 2)}`;
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(sample);
    if (match !== null) return match[0].replace(/\s+/g, " ").slice(0, 120);
  }
  return undefined;
}

/** Text of a tool result's content, for scanning. */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) =>
      typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : [],
    )
    .join("\n");
}

/** Tool result content with the warning put first, in the content's own shape. */
export function withWarning(content: unknown, warning: string): unknown {
  if (typeof content === "string") return `${warning}\n\n${content}`;
  if (Array.isArray(content)) return [{ type: "text", text: warning }, ...content];
  return content;
}
