// Postgres access layer. Connects via DATABASE_URL (backend/.env).
// Scrapers INSERT signals here (every ~24h); the pipeline SELECTs them.
// See backend/DATABASE.md for setup.
import { Pool } from "pg";
import type { ClientBaseline, RawSignal, SignalCategory } from "./types.js";

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

/** Upsert a synthetic KYC baseline. */
export async function saveBaseline(baseline: ClientBaseline): Promise<void> {
  await pool.query(
    `INSERT INTO kyc_baselines (client_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (client_id) DO UPDATE SET data = $2, updated_at = now()`,
    [baseline.clientId, JSON.stringify(baseline)],
  );
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
