// Weighted aggregation. Confidence-adjusted: magnitude × weight × confidence.
// See spec sections 3.5 and 6.5. Weights are loaded from a compliance-owned
// JSON config (the AI executes policy, it does not set policy).

import { createRequire } from "node:module";
import type {
  CompositeScoreResult,
  SignalScore,
  SignalWeightsConfig,
} from "../types.js";
import type { HardGateResult } from "./hardGate.js";

const require = createRequire(import.meta.url);
const weightsConfig = require("../config/signalWeights.json") as SignalWeightsConfig;

export const SIGNAL_WEIGHTS = weightsConfig.weights;
export const WEIGHTS_VERSION = weightsConfig.version;

// Weights are RELATIVE importance (they sum to 100 across 10 categories, so the
// most-important factor is 20). We scale each signal's severity by its weight
// relative to that maximum, so a single high-importance, high-magnitude,
// high-confidence signal can on its own push a client into HIGH — matching
// README's reference table (e.g. structuring / business-model pivot = high).
const MAX_WEIGHT = Math.max(...Object.values(SIGNAL_WEIGHTS));

function riskFlagFor(score: number): "low" | "medium" | "high" {
  if (score < 30) return "low";
  if (score <= 60) return "medium";
  return "high";
}

export function computeCompositeScore(
  scores: SignalScore[],
  hardGateResult: HardGateResult,
): CompositeScoreResult {
  const clientId = scores[0]?.signalId ? scores[0]!.signalId.split("-").slice(-1)[0]! : "unknown";

  if (hardGateResult.matched) {
    return {
      clientId,
      compositeScore: 100,
      riskFlag: "critical",
      contributingSignals: scores,
      neutralSignals: [],
      hardGateTriggered: true,
      hardGateReason: `Sanctions/PEP exact match: ${hardGateResult.matchedEntity ?? "unknown"}`,
    };
  }

  const riskSignals = scores.filter((s) => s.direction === "risk_increasing");
  const positiveSignals = scores.filter((s) => s.direction === "positive");
  const neutralSignals = scores.filter((s) => s.direction === "neutral_update");

  const riskSum = riskSignals.reduce(
    (acc, s) => acc + (s.magnitude * ((SIGNAL_WEIGHTS[s.category] ?? 0) / MAX_WEIGHT) * s.confidence),
    0,
  );
  const softening = positiveSignals.reduce(
    (acc, s) => acc + (s.magnitude * ((SIGNAL_WEIGHTS[s.category] ?? 0) / MAX_WEIGHT) * s.confidence * 0.3),
    0,
  );

  const compositeScore = Math.max(0, Math.min(100, riskSum - softening));

  return {
    clientId,
    compositeScore: Math.round(compositeScore),
    riskFlag: riskFlagFor(compositeScore),
    contributingSignals: riskSignals,
    neutralSignals, // these trigger the threshold-refresh workflow, not the score
    hardGateTriggered: false,
  };
}
