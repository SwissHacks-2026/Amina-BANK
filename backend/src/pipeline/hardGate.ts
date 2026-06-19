// Hard gate — sanctions/PEP. Binary, deterministic, EXACT match only.
// A match short-circuits the whole pipeline to CRITICAL. See spec section 3.2.
//
// For the demo this checks against a local sanctions stub. In production the
// `querySanctions` function is swapped for a call to the connected sanctions MCP
// (OpenSanctions / OFAC). The exact-match contract stays the same either way.

import type { ClientBaseline } from "../types.js";

export interface HardGateResult {
  matched: boolean;
  matchedEntity?: string;
  sourceUrl?: string;
}

// Demo stub list. Replace `querySanctions` with the MCP call when wired up.
const DEMO_SANCTIONS = new Set(
  [
    "blocked holdings ltd",
    "ivan petrov",
    "north star trading fze",
  ].map((s) => s.toLowerCase().trim()),
);

async function querySanctions(name: string): Promise<{ hit: boolean; sourceUrl?: string }> {
  // TODO: swap for MCP sanctions lookup (OpenSanctions/OFAC). Keep it EXACT match.
  const hit = DEMO_SANCTIONS.has(name.toLowerCase().trim());
  return { hit, sourceUrl: hit ? "https://www.opensanctions.org" : undefined };
}

export async function checkSanctionsPEP(
  legalName: string,
  ubos: ClientBaseline["ubos"],
): Promise<HardGateResult> {
  // entity itself
  const entity = await querySanctions(legalName);
  if (entity.hit) return { matched: true, matchedEntity: legalName, sourceUrl: entity.sourceUrl };

  // each UBO (and any PEP UBO is an automatic gate)
  for (const ubo of ubos) {
    if (ubo.isPEP) {
      return {
        matched: true,
        matchedEntity: `${ubo.name} (PEP)`,
        sourceUrl: "internal:kyc:pep-flag",
      };
    }
    const hit = await querySanctions(ubo.name);
    if (hit.hit) return { matched: true, matchedEntity: ubo.name, sourceUrl: hit.sourceUrl };
  }

  return { matched: false };
}
