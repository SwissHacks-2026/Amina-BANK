// Adapter: Alice's corporate registry drift report (scrapers/corporate/kyc_drift_report.json)
// → our RawSignal[] (sourceType "registry" → narrative route → embedding gate → Stage 2).
// Her checker compares the live registry (GLEIF/OpenCorporates) against the KYC baseline and
// emits negative_alerts when something structural changed (status, officers, jurisdiction).
//
// Her output: [{ company_name, status: "HEALTHY"|"DRIFT DETECTED", negative_alerts: string[],
//   missing_info_warnings: string[], raw_api_data: {...} }]
import { existsSync, readFileSync } from "node:fs";
import type { RawSignal, SignalCategory } from "../types.js";
import { normName } from "./sanctionsAdapter.js";

interface RegistryReport {
  company_name: string;
  status?: string;
  negative_alerts?: string[];
  missing_info_warnings?: string[];
}

const DEFAULT_PATH = new URL("../../../scrapers/corporate/kyc_drift_report.json", import.meta.url);

// Pick the drift category from the alert wording (registry alerts are short, keyword-rich).
function categoryFor(alerts: string[]): SignalCategory {
  const text = alerts.join(" ").toLowerCase();
  if (/(ceo|cfo|director|officer|personnel)/.test(text)) return "key_personnel_change";
  if (/(dissolved|status|struck|liquidat|inactive)/.test(text)) return "legal_form_change";
  if (/(jurisdiction|moved|relocat|domicile)/.test(text)) return "jurisdiction_change";
  if (/(name change|renamed|formerly)/.test(text)) return "entity_name_change";
  return "negative_news";
}

/**
 * Returns { clientId → RawSignal[] }. clientId is resolved from the company name via the
 * baselines' legalName (nameToId). Companies that are HEALTHY / unmatched are skipped.
 */
export function loadRegistrySignals(
  nameToId: Map<string, string>,
  path: URL | string = DEFAULT_PATH,
): Record<string, RawSignal[]> {
  if (!existsSync(path)) return {};
  const reports = JSON.parse(readFileSync(path, "utf8")) as RegistryReport[];
  const out: Record<string, RawSignal[]> = {};

  for (const r of reports) {
    const alerts = r.negative_alerts ?? [];
    if (!alerts.length) continue; // HEALTHY → nothing to flag
    const clientId = nameToId.get(normName(r.company_name));
    if (!clientId) continue; // not in our portfolio
    const signal: RawSignal = {
      signalId: `registry-${clientId}`,
      clientId,
      category: categoryFor(alerts),
      detectedAt: "2026-06-20",
      sourceType: "registry",
      sourceUrl: "registry:corporate-checker",
      rawText: `Corporate registry drift for ${r.company_name}: ${alerts.join(" | ")}`,
    };
    (out[clientId] ??= []).push(signal);
  }
  return out;
}
