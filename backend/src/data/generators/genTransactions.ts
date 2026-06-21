// Generate synthetic per-client transaction history anchored to the REAL KYC baselines
// (expected volume + jurisdiction regions) and to the AML-typology thresholds in riskPolicy.
// Most clients get clean activity; a realistic minority get an injected typology so the
// portfolio shows transaction-driven drift (cross-border mule / structuring / dormancy).
//   run:  npx tsx src/data/generators/genTransactions.ts   → writes data/synthetic_transactions.json
import "dotenv/config";
import { writeFileSync } from "node:fs";
import type { ClientBaseline, TransactionRecord } from "../../types.js";
import { loadBaselines } from "../../ingest/kycAdapter.js";

const OUT = new URL("../../../../data/synthetic_transactions.json", import.meta.url);
const OFFSHORE = ["Seychelles", "Cayman Islands", "British Virgin Islands"];

// deterministic per-client "typical" payment size (kept OUT of the $8k–$10k structuring band)
function typical(b: ClientBaseline): number {
  const v = Math.max(60_000, Math.min(b.expectedMonthlyVolumeUSD / 8, 4_000_000));
  return Math.round(v / 1000) * 1000 + 500; // avoid round-band collisions
}

let seq = 0;
function tx(clientId: string, date: string, amountUSD: number, region: string, direction: "inbound" | "outbound"): TransactionRecord {
  return { txId: `TX-${clientId}-${++seq}`, clientId, date, amountUSD, counterpartyRegion: region, direction, isSynthetic: true, generatedBy: "manual" };
}

// Clean monthly activity to declared regions — never trips a typology.
function cleanActivity(b: ClientBaseline): TransactionRecord[] {
  const home = b.expectedCounterpartyRegions[0] ?? "United States";
  const alt = b.expectedCounterpartyRegions[1] ?? home;
  const a = typical(b);
  return [
    tx(b.clientId, "2026-04-08", a, home, "inbound"),
    tx(b.clientId, "2026-04-22", Math.round(a * 0.9), alt, "outbound"),
    tx(b.clientId, "2026-05-09", Math.round(a * 1.1), home, "inbound"),
    tx(b.clientId, "2026-05-24", a, alt, "outbound"),
    tx(b.clientId, "2026-06-07", Math.round(a * 0.95), home, "inbound"),
    tx(b.clientId, "2026-06-15", Math.round(a * 0.9), alt, "outbound"),
  ];
}

// Injected typologies (anchored to each client's story).
function injected(b: ClientBaseline): TransactionRecord[] {
  const home = b.expectedCounterpartyRegions[0] ?? "United States";
  switch (b.clientId) {
    case "CUST-002": {
      // Terraform Labs — collapse: dormant for ~7 months, then a cross-border outflow to offshore.
      const a = typical(b);
      return [
        tx(b.clientId, "2025-10-30", a, home, "inbound"),
        tx(b.clientId, "2025-11-04", Math.round(a * 0.8), home, "outbound"),
        // dormant Nov 2025 → Jun 2026 (>180d), then revival + offshore pass-through
        tx(b.clientId, "2026-06-03", 2_400_000, home, "inbound"),
        tx(b.clientId, "2026-06-08", 1_300_000, OFFSHORE[0]!, "outbound"),
        tx(b.clientId, "2026-06-14", 1_050_000, OFFSHORE[1]!, "outbound"),
      ];
    }
    case "CUST-007": {
      // Bybit — structuring: 4 transfers just below the $10k CTR within 30 days.
      return [
        ...cleanActivity(b).slice(0, 2),
        tx(b.clientId, "2026-06-02", 9_600, home, "outbound"),
        tx(b.clientId, "2026-06-06", 9_400, home, "outbound"),
        tx(b.clientId, "2026-06-11", 9_750, home, "outbound"),
        tx(b.clientId, "2026-06-16", 8_900, home, "outbound"),
      ];
    }
    case "CUST-008": {
      // JPEX — money-mule: large inbound immediately passed out to offshore (passThrough ~0.95).
      return [
        ...cleanActivity(b).slice(0, 2),
        tx(b.clientId, "2026-06-05", 3_000_000, home, "inbound"),
        tx(b.clientId, "2026-06-09", 1_500_000, OFFSHORE[0]!, "outbound"),
        tx(b.clientId, "2026-06-13", 1_350_000, OFFSHORE[2]!, "outbound"),
      ];
    }
    default:
      return cleanActivity(b);
  }
}

const baselines = loadBaselines();
const out: Record<string, TransactionRecord[]> = {};
for (const b of baselines) out[b.clientId] = injected(b);

writeFileSync(OUT, JSON.stringify(out, null, 2));
const injectedIds = ["CUST-002", "CUST-007", "CUST-008"];
console.log(
  `Wrote ${Object.keys(out).length} clients' transactions → data/synthetic_transactions.json ` +
    `(${Object.values(out).flat().length} txs; typologies injected for ${injectedIds.join(", ")}).`,
);
