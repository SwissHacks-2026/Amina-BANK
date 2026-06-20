// Ingest the latest scraper outputs into Postgres (one refresh cycle).
// Reads KYC baselines + news drift signals via the adapters and writes them to the DB.
// Signals are fully refreshed each cycle (delete + re-insert) so `fetched_at` reflects the
// last 24h pull.
import {
  clearSanctionsHits,
  clearSignals,
  saveBaseline,
  saveSanctionsHit,
  saveSignal,
} from "../db.js";
import { loadBaselines } from "./kycAdapter.js";
import { loadDriftSignals } from "./newsAdapter.js";
import { loadRegistrySignals } from "./corporateAdapter.js";
import { loadKiaraFlags, normName } from "./sanctionsAdapter.js";

export async function ingestToDb(): Promise<{
  baselines: number;
  signals: number;
  registrySignals: number;
  sanctions: number;
}> {
  const baselines = loadBaselines();
  for (const b of baselines) await saveBaseline(b);

  // Resolve company names → clientId so registry/name-keyed sources can join the portfolio.
  const nameToId = new Map(baselines.map((b) => [normName(b.legalName), b.clientId]));

  // Layer-1 narrative signals: Giulio's news + Alice's corporate registry drift.
  const newsByClient = loadDriftSignals();
  const registryByClient = loadRegistrySignals(nameToId);

  await clearSignals(); // full refresh
  let signals = 0;
  let registrySignals = 0;
  for (const list of Object.values(newsByClient)) {
    for (const s of list) {
      await saveSignal(s);
      signals += 1;
    }
  }
  for (const list of Object.values(registryByClient)) {
    for (const s of list) {
      await saveSignal(s);
      registrySignals += 1;
    }
  }

  // Layer-1 sanctions watchlist: Kiara's screener flags → sanctions_hits table.
  const flags = loadKiaraFlags();
  await clearSanctionsHits(); // full refresh
  for (const h of flags.values()) await saveSanctionsHit(h);

  return { baselines: baselines.length, signals, registrySignals, sanctions: flags.size };
}
