// Hard gate — sanctions/PEP. Binary, deterministic, EXACT match only.
// A match short-circuits the whole pipeline to CRITICAL. See spec section 3.2.
//
// For the demo this checks against a local sanctions stub. In production the
// `querySanctions` function is swapped for a call to the connected sanctions MCP
// (OpenSanctions / OFAC). The exact-match contract stays the same either way.

import type { ClientBaseline } from "../types.js";
import { loadKiaraFlags, loadSanctionsHits, normName, type SanctionsHit } from "../ingest/sanctionsAdapter.js";
import { loadDirectSanctionsHits } from "../ingest/sanctionsFlagsAdapter.js";
import { loadBaselines } from "../ingest/kycAdapter.js";
import { POLICY } from "./policy.js";

export interface SanctionsReviewCandidate {
  name: string; // the screened name (client or UBO)
  matchedEntity: string; // the sanctioned record it resembled
  score: number;
  source: string;
}

export interface HardGateResult {
  matched: boolean; // confirmed → CRITICAL short-circuit
  matchedEntity?: string;
  sourceUrl?: string;
  reviewRequired?: boolean; // candidate match below auto-threshold → human review queue
  reviewCandidates?: SanctionsReviewCandidate[];
}

// Real OFAC/UN watchlist. Priority: Postgres (sanctions_hits, fed by db:ingest) → Kiara's
// JSON file → legacy data/sanctions_hits.json. Loaded once and cached. The DB path is the
// "scrapers → Postgres → pipeline" loop; the file paths are the keyless fallback.
let cachedHits: Map<string, SanctionsHit> | null = null;

async function getSanctionsHits(): Promise<Map<string, SanctionsHit>> {
  if (cachedHits) return cachedHits;
  if (process.env.DATABASE_URL) {
    try {
      const { loadAllSanctionsHits, pingDb } = await import("../db.js");
      if (await pingDb()) {
        const fromDb = await loadAllSanctionsHits();
        if (fromDb.size) {
          cachedHits = fromDb;
          return cachedHits;
        }
      }
    } catch {
      // fall through to file-based loading
    }
  }
  const merged = new Map<string, SanctionsHit>([...loadSanctionsHits(), ...loadKiaraFlags()]);
  // Also fold in DIRECT customer/UBO hits from Kiara's screening report (kyc_sanctions_flags.json).
  // Only names that ARE a customer or UBO drive the gate; linked-entity contagion is handled in the
  // pipeline (it must not auto-CRITICAL the customer). Guarded so a missing file never breaks load.
  try {
    for (const [key, hit] of loadDirectSanctionsHits(loadBaselines())) {
      if (!merged.has(key)) merged.set(key, hit);
    }
  } catch {
    /* baselines or flags file absent → skip; demo stub remains in effect */
  }
  cachedHits = merged;
  return cachedHits;
}

// Demo stub list (for the bundled demo cases not present on real lists).
// Normalised with the SAME normName() as the real-hits path so case, whitespace and
// punctuation variants ("Acme Ltd." vs "Acme Ltd") match consistently.
const DEMO_SANCTIONS = new Set(
  ["blocked holdings ltd", "ivan petrov", "north star trading fze"].map((s) => normName(s)),
);

interface Query {
  hit: boolean;
  entity?: string;
  sourceUrl?: string;
  score: number; // 0-100 fuzzy score (demo exact match = 100)
  source?: string;
  jurisdiction?: string; // sanctioned record's jurisdiction (secondary identifier)
}

async function querySanctions(name: string): Promise<Query> {
  // 1) real sanctions data (DB / Kiara) first
  const real = (await getSanctionsHits()).get(normName(name));
  if (real) {
    return {
      hit: true,
      entity: real.matchedEntity,
      sourceUrl: `sanctions:${real.source}`,
      score: real.score,
      source: real.source,
      jurisdiction: real.jurisdiction,
    };
  }
  // 2) demo fallback — treated as an exact (score 100) confirmed hit
  const hit = DEMO_SANCTIONS.has(normName(name));
  return {
    hit,
    entity: hit ? name : undefined,
    sourceUrl: hit ? "https://www.opensanctions.org" : undefined,
    score: hit ? 100 : 0,
    source: hit ? "DEMO" : undefined,
  };
}

export async function checkSanctionsPEP(
  legalName: string,
  ubos: ClientBaseline["ubos"],
  baselineJurisdiction?: string,
): Promise<HardGateResult> {
  // PEP UBO is an automatic gate (declared in KYC, deterministic).
  for (const ubo of ubos) {
    if (ubo.isPEP) {
      return { matched: true, matchedEntity: `${ubo.name} (PEP)`, sourceUrl: "internal:kyc:pep-flag" };
    }
  }

  const { autoThreshold, reviewThreshold } = POLICY.sanctions;
  const candidates: SanctionsReviewCandidate[] = [];
  const names = [legalName, ...ubos.map((u) => u.name)];

  for (const name of names) {
    const q = await querySanctions(name);
    if (!q.hit) continue;

    // Secondary identifier check (homonym disambiguation): if the sanctioned record's
    // jurisdiction is known and DISAGREES with the client's, demote to review even at a
    // high score. Unknown jurisdiction → don't block on it.
    const identifierMismatch =
      q.jurisdiction && baselineJurisdiction
        ? normName(q.jurisdiction) !== normName(baselineJurisdiction)
        : false;

    if (q.score >= autoThreshold && !identifierMismatch) {
      return { matched: true, matchedEntity: q.entity ?? name, sourceUrl: q.sourceUrl };
    }
    if (q.score >= reviewThreshold) {
      candidates.push({ name, matchedEntity: q.entity ?? name, score: q.score, source: q.source ?? "sanctions" });
    }
  }

  if (candidates.length) return { matched: false, reviewRequired: true, reviewCandidates: candidates };
  return { matched: false };
}
