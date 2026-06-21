// End-to-end pipeline proof. `npx tsx src/pipelineHealth.ts`
// Traces data through EVERY link and prints PASS/FAIL so a teammate can see the whole
// Layer-1 + Layer-2 → DB → pipeline → API chain works without breakdown.
import "dotenv/config";
import { existsSync } from "node:fs";
import { pingDb, pool, loadAllBaselines, loadAllSignals, loadAllSanctionsHits } from "./db.js";
import { loadTransactions } from "./ingest/txAdapter.js";
import { runPipeline } from "./pipeline/pipeline.js";

const API = `http://localhost:${process.env.PORT ?? 8787}`;
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? `  — ${detail}` : ""}`);
  ok ? pass++ : fail++;
}
function header(s: string) {
  console.log(`\n${s}`);
}

async function main() {
  console.log("AMINA pipeline health check — Layer1/2 → DB → pipeline → API → frontend\n" + "─".repeat(70));

  // ── LINK 1: source files exist (where data is collected) ──
  header("1. SOURCE FILES (collection)");
  const files: [string, string][] = [
    ["docs/kyc_database.json", "KYC baseline (L2)"],
    ["scrapers/news-feed/kyc_drift_signals.json", "News (L1, Giulio)"],
    ["scrapers/corporate/kyc_drift_report.json", "Registry (L1, Alice)"],
    ["scrapers/sanctions/kyc_sanctions_flags.json", "Sanctions (L1, Kiara)"],
    ["data/synthetic_transactions.json", "Transactions (L2, synthetic)"],
  ];
  for (const [rel, label] of files) {
    check(label, existsSync(new URL(`../../${rel}`, import.meta.url)), rel);
  }

  // ── LINK 2: Postgres reachable + populated (storage) ──
  header("2. POSTGRES (storage)");
  const dbUp = await pingDb();
  check("DB reachable", dbUp, process.env.DATABASE_URL ? "DATABASE_URL set" : "no DATABASE_URL");
  if (!dbUp) {
    console.log("\n⚠️  DB down — run Postgres + `npm run db:init && npm run db:ingest`. Aborting.");
    process.exit(1);
  }
  const baselines = await loadAllBaselines();
  const signals = await loadAllSignals();
  const sanctions = await loadAllSanctionsHits();
  const sigCount = Object.values(signals).flat().length;
  check("kyc_baselines populated", baselines.length > 0, `${baselines.length} clients`);
  check("signals populated", sigCount > 0, `${sigCount} signals`);
  check("sanctions_hits populated", sanctions.size > 0, `${sanctions.size} watchlist entries`);
  check("baselines have expected regions (L2 enriched)",
    baselines.every((b) => b.expectedCounterpartyRegions.length > 0),
    "needed for cross-border AML check");

  // ── LINK 3: Layer-2 transactions load ──
  header("3. LAYER-2 TRANSACTIONS");
  const txs = loadTransactions();
  const txTotal = Object.values(txs).flat().length;
  check("synthetic transactions load", txTotal > 0, `${txTotal} txs across ${Object.keys(txs).length} clients`);

  // ── LINK 4: full pipeline runs per client (no breakdown) ──
  header("4. PIPELINE (scoring, all clients)");
  let scored = 0;
  let withTx = 0;
  const flags: Record<string, number> = {};
  for (const b of baselines) {
    const sigs = signals[b.clientId] ?? [];
    const t = txs[b.clientId] ?? [];
    const trigger = t.length
      ? [...sigs, { signalId: `tx-${b.clientId}`, clientId: b.clientId, category: "cross_border_anomaly" as const, detectedAt: "2026-06-20", sourceType: "transaction" as const }]
      : sigs;
    try {
      const r = await runPipeline(b, t, trigger);
      scored++;
      flags[r.composite.riskFlag] = (flags[r.composite.riskFlag] ?? 0) + 1;
      if (r.composite.contributingSignals.some((s) => ["cross_border_anomaly", "structuring_pattern", "dormancy_break"].includes(s.category))) withTx++;
    } catch (e) {
      check(`pipeline ${b.clientId}`, false, (e as Error).message);
    }
  }
  check("every client scored without crash", scored === baselines.length, `${scored}/${baselines.length}`);
  check("flags are discriminating (not all same)", Object.keys(flags).length > 1, JSON.stringify(flags));
  check("transaction typologies fire (L2 numeric works)", withTx > 0, `${withTx} clients with AML typology`);

  // ── LINK 5: REST API serves it (backend → frontend contract) ──
  header("5. API (backend → frontend)");
  try {
    const res = await fetch(`${API}/api/portfolio/alerts`, { signal: AbortSignal.timeout(200_000) });
    const data = (await res.json()) as { alerts?: unknown[]; source?: string; error?: string };
    check("/api/portfolio/alerts responds 200", res.ok, `http ${res.status}`);
    check("API reads from Postgres", data.source === "postgres", `source=${data.source}`);
    check("API returns all clients", (data.alerts?.length ?? 0) === baselines.length, `${data.alerts?.length} alerts`);
  } catch (e) {
    check("/api/portfolio/alerts reachable", false, `${(e as Error).message} (is the backend running? npm run dev)`);
  }
  // frontend dev server (optional)
  try {
    const fe = await fetch("http://localhost:5173", { signal: AbortSignal.timeout(4000) });
    check("frontend dev server up", fe.ok, "http " + fe.status);
  } catch {
    check("frontend dev server up", false, "not running (cd frontend && npm run dev) — optional");
  }

  console.log("\n" + "─".repeat(70));
  console.log(`RESULT: ${pass} passed, ${fail} failed → ${fail === 0 ? "✅ PIPELINE HEALTHY" : "❌ SEE FAILURES ABOVE"}`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
