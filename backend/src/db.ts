// Postgres access layer. Connects via DATABASE_URL (backend/.env).
// Scrapers INSERT signals here (every ~24h); the pipeline SELECTs them.
// See backend/DATABASE.md for setup.
import { Pool } from "pg";
import type { ClientBaseline, RawSignal, SignalCategory } from "./types.js";
import { normName, type SanctionsHit } from "./ingest/sanctionsAdapter.js";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** True if the database is reachable. */
export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** Delete all stored signals (used for a full refresh cycle). */
export async function clearSignals(): Promise<void> {
  await pool.query("DELETE FROM signals");
}

/** Save one collected signal (called by the scraper adapters). */
export async function saveSignal(s: RawSignal): Promise<void> {
  await pool.query(
    `INSERT INTO signals (client_id, category, source_type, source_url, raw_text, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [s.clientId, s.category, s.sourceType, s.sourceUrl ?? null, s.rawText ?? null, s.detectedAt],
  );
}

/** Load a client's stored signals (called by the pipeline instead of live fetch). */
export async function loadSignals(clientId: string): Promise<RawSignal[]> {
  const { rows } = await pool.query(
    `SELECT id, client_id, category, source_type, source_url, raw_text, detected_at
       FROM signals WHERE client_id = $1 ORDER BY detected_at DESC`,
    [clientId],
  );
  return rows.map((r) => ({
    signalId: String(r.id),
    clientId: r.client_id as string,
    category: r.category as SignalCategory,
    detectedAt: new Date(r.detected_at).toISOString(),
    sourceType: r.source_type as RawSignal["sourceType"],
    sourceUrl: r.source_url ?? undefined,
    rawText: r.raw_text ?? undefined,
  }));
}

/** Load all KYC baselines from the DB (JSONB column → ClientBaseline). */
export async function loadAllBaselines(): Promise<ClientBaseline[]> {
  const { rows } = await pool.query("SELECT data FROM kyc_baselines ORDER BY client_id");
  return rows.map((r) => r.data as ClientBaseline);
}

/** Load all signals from the DB, grouped by clientId. */
export async function loadAllSignals(): Promise<Record<string, RawSignal[]>> {
  const { rows } = await pool.query(
    `SELECT id, client_id, category, source_type, source_url, raw_text, detected_at
       FROM signals ORDER BY detected_at DESC`,
  );
  const out: Record<string, RawSignal[]> = {};
  for (const r of rows) {
    (out[r.client_id] ??= []).push({
      signalId: String(r.id),
      clientId: r.client_id as string,
      category: r.category as SignalCategory,
      detectedAt: new Date(r.detected_at).toISOString(),
      sourceType: r.source_type as RawSignal["sourceType"],
      sourceUrl: r.source_url ?? undefined,
      rawText: r.raw_text ?? undefined,
    });
  }
  return out;
}

/** Upsert a synthetic KYC baseline. */
export async function saveBaseline(baseline: ClientBaseline): Promise<void> {
  await pool.query(
    `INSERT INTO kyc_baselines (client_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (client_id) DO UPDATE SET data = $2, updated_at = now()`,
    [baseline.clientId, JSON.stringify(baseline)],
  );
}

/** Delete all stored sanctions hits (full refresh of the watchlist). */
export async function clearSanctionsHits(): Promise<void> {
  await pool.query("DELETE FROM sanctions_hits");
}

/** Upsert one sanctions watchlist hit (keyed by normalized name). */
export async function saveSanctionsHit(h: SanctionsHit): Promise<void> {
  await pool.query(
    `INSERT INTO sanctions_hits (norm_name, query, matched_entity, score, source, jurisdiction)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (norm_name) DO UPDATE SET
       query = $2, matched_entity = $3, score = $4, source = $5, jurisdiction = $6, fetched_at = now()`,
    [normName(h.query), h.query, h.matchedEntity, h.score, h.source, h.jurisdiction ?? null],
  );
}

/** Load the whole sanctions watchlist from the DB, keyed by normalized name. */
export async function loadAllSanctionsHits(): Promise<Map<string, SanctionsHit>> {
  const map = new Map<string, SanctionsHit>();
  const { rows } = await pool.query(
    "SELECT norm_name, query, matched_entity, score, source, jurisdiction FROM sanctions_hits",
  );
  for (const r of rows) {
    map.set(r.norm_name as string, {
      query: r.query as string,
      matchedEntity: (r.matched_entity ?? r.query) as string,
      score: Number(r.score ?? 100),
      source: (r.source ?? "sanctions") as string,
      jurisdiction: r.jurisdiction ?? undefined,
    });
  }
  return map;
}

/** Record a human-in-the-loop decision (audit trail). */
export async function saveDecision(d: {
  clientId: string;
  actor: string;
  action: string;
  detail?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO decisions (client_id, actor, action, detail) VALUES ($1, $2, $3, $4)`,
    [d.clientId, d.actor, d.action, d.detail ?? ""],
  );
}
