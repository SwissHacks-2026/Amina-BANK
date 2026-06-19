// Anthropic client wrapper with cost logging. Falls back to a deterministic STUB
// when ANTHROPIC_API_KEY is absent, so the whole pipeline runs keyless for demos.
import Anthropic from "@anthropic-ai/sdk";
import type { CostLogEntry } from "../types.js";

// Approx public pricing (USD per 1M tokens) — used only for the cost readout.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
};

export const costLog: CostLogEntry[] = [];

function nowISO(): string {
  // Date.now/new Date are fine in normal runtime (this is not a workflow script)
  return new Date().toISOString();
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isLiveLLM(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function logCost(
  stage: 2 | 3,
  model: string,
  inputTokens: number,
  outputTokens: number,
  signalId: string,
): void {
  const price = PRICING[model] ?? { in: 0, out: 0 };
  costLog.push({
    stage,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUSD: (inputTokens * price.in + outputTokens * price.out) / 1_000_000,
    signalId,
    timestamp: nowISO(),
  });
}

/**
 * Calls Claude and returns the raw text. When no key is set, calls `stub()` instead
 * and logs an estimated token cost so the cost table still populates in demos.
 */
export async function callClaude(opts: {
  stage: 2 | 3;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signalId: string;
  stub: () => string;
}): Promise<{ text: string; live: boolean }> {
  const c = getClient();
  if (!c) {
    const text = opts.stub();
    // rough token estimate (~4 chars/token) so the cost readout is non-empty
    logCost(opts.stage, opts.model, Math.ceil((opts.system.length + opts.user.length) / 4), Math.ceil(text.length / 4), opts.signalId);
    return { text, live: false };
  }
  const res = await c.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  logCost(opts.stage, opts.model, res.usage.input_tokens, res.usage.output_tokens, opts.signalId);
  return { text, live: true };
}

/** Extract the first JSON object from a model response (tolerates stray prose/fences). */
export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`);
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

export function costSummary() {
  const totalUSD = costLog.reduce((s, e) => s + e.estimatedCostUSD, 0);
  const byStage = { 2: 0, 3: 0 } as Record<2 | 3, number>;
  for (const e of costLog) byStage[e.stage] += e.estimatedCostUSD;
  return {
    calls: costLog.length,
    totalUSD,
    stage2USD: byStage[2],
    stage3USD: byStage[3],
    costPer1000USD: costLog.length ? (totalUSD / costLog.length) * 1000 : 0,
    entries: costLog,
  };
}
