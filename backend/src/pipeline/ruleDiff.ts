// Numeric signals — pure arithmetic, NO LLM. See spec section 3.1.
import type { ClientBaseline, RawSignal, SignalScore, TransactionRecord } from "../types.js";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Sum amounts of txs within the last `days` from the most recent tx date. */
function recentWindow(txs: TransactionRecord[], days: number): TransactionRecord[] {
  if (txs.length === 0) return [];
  const latest = Math.max(...txs.map((t) => Date.parse(t.date)));
  const cutoff = latest - days * 86_400_000;
  return txs.filter((t) => Date.parse(t.date) >= cutoff);
}

export function checkTransactionAnomaly(
  baseline: ClientBaseline,
  recentTxs: TransactionRecord[],
): SignalScore | null {
  const monthTxs = recentWindow(recentTxs, 30);
  if (monthTxs.length === 0) return null;

  const monthVolume = monthTxs.reduce((s, t) => s + t.amountUSD, 0);
  const expected = baseline.expectedMonthlyVolumeUSD || 1;
  const deviation = (monthVolume - expected) / expected; // fraction, can be negative

  // cross-border component: outbound to regions outside the expected set
  const crossBorder = monthTxs.filter(
    (t) => t.direction === "outbound" && !baseline.expectedCounterpartyRegions.includes(t.counterpartyRegion),
  );

  if (deviation < 0.5 && crossBorder.length === 0) return null; // within normal range

  const magnitude = clamp(deviation * 100);
  return {
    signalId: `txanom-${baseline.clientId}`,
    category: crossBorder.length > 0 ? "cross_border_anomaly" : "structuring_pattern",
    method: "rule_diff",
    magnitude,
    direction: "risk_increasing",
    rationale:
      `Last-30-day volume of $${Math.round(monthVolume).toLocaleString()} is ` +
      `${Math.round(deviation * 100)}% vs the expected $${expected.toLocaleString()}` +
      (crossBorder.length
        ? `, with ${crossBorder.length} outbound transfer(s) to unexpected region(s): ${[...new Set(crossBorder.map((t) => t.counterpartyRegion))].join(", ")}.`
        : "."),
    sourceCitations: [`internal:tx-monitor:${baseline.clientId}`],
    confidence: 0.9, // deterministic arithmetic → high confidence
  };
}

export function checkDormancyBreak(
  baseline: ClientBaseline,
  recentTxs: TransactionRecord[],
  dormancyWindowDays = 180,
): SignalScore | null {
  if (recentTxs.length < 2) return null;
  const sorted = [...recentTxs].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  // find the largest gap between consecutive txs
  let maxGapDays = 0;
  let gapEndIdx = -1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(sorted[i]!.date) - Date.parse(sorted[i - 1]!.date)) / 86_400_000;
    if (gap > maxGapDays) {
      maxGapDays = gap;
      gapEndIdx = i;
    }
  }
  if (maxGapDays < dormancyWindowDays || gapEndIdx === -1) return null;

  // activity right after the gap
  const afterGap = recentWindow(sorted.slice(gapEndIdx), 30);
  const burst = afterGap.reduce((s, t) => s + t.amountUSD, 0);
  if (burst === 0) return null;

  return {
    signalId: `dormancy-${baseline.clientId}`,
    category: "dormancy_break",
    method: "rule_diff",
    magnitude: clamp(40 + maxGapDays / 10),
    direction: "risk_increasing",
    rationale:
      `Account dormant for ~${Math.round(maxGapDays)} days, then reactivated with ` +
      `$${Math.round(burst).toLocaleString()} of activity in the following 30 days.`,
    sourceCitations: [`internal:tx-monitor:${baseline.clientId}`],
    confidence: 0.85,
  };
}

export function checkFundingScale(raw: RawSignal): SignalScore | null {
  const prev = raw.rawNumericContext?.previousFundingUSD ?? 0;
  const curr = raw.rawNumericContext?.currentFundingUSD ?? raw.rawNumeric ?? 0;
  if (curr <= 0) return null;
  const multiple = prev > 0 ? curr / prev : curr / 1_000_000;

  return {
    signalId: raw.signalId,
    category: "funding_scale_change",
    method: "rule_diff",
    magnitude: Math.round(clamp(Math.log10(Math.max(multiple, 1.01)) * 50)),
    // default neutral — Stage 2 may re-judge as positive or risk_increasing with narrative context
    direction: "neutral_update",
    rationale:
      `Funding changed from $${prev.toLocaleString()} to $${curr.toLocaleString()}` +
      ` (~${multiple.toFixed(1)}x). Reassess transaction-monitoring thresholds.`,
    sourceCitations: raw.sourceUrl ? [raw.sourceUrl] : [`funding_db:${raw.signalId}`],
    confidence: 0.8,
  };
}
