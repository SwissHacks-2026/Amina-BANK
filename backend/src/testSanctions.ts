// Tiny direct test of the sanctions hard gate — no server, no pipeline.
//   run:  npx tsx src/testSanctions.ts
// Calls checkSanctionsPEP() with hand-made inputs and prints the verdict so you
// can SEE the company-name (Layer-2) ↔ sanctions matching work case by case.
import "dotenv/config";
import { checkSanctionsPEP } from "./pipeline/hardGate.js";

type Ubo = { name: string; ownershipPct: number; isPEP: boolean };

const cases: { label: string; legalName: string; ubos: Ubo[]; jurisdiction?: string; expect: string }[] = [
  {
    label: "Sanctioned COMPANY name (exact)",
    legalName: "Blocked Holdings Ltd",
    ubos: [{ name: "Jane Clean", ownershipPct: 100, isPEP: false }],
    jurisdiction: "Cyprus",
    expect: "matched=true → CRITICAL (company on list)",
  },
  {
    label: "Clean company, clean owners",
    legalName: "Sunrise Bakery AG",
    ubos: [{ name: "Anna Muster", ownershipPct: 100, isPEP: false }],
    jurisdiction: "Switzerland",
    expect: "matched=false → pipeline continues",
  },
  {
    label: "Clean company, but a UBO is on the list",
    legalName: "Sunrise Bakery AG",
    ubos: [{ name: "Ivan Petrov", ownershipPct: 40, isPEP: false }],
    jurisdiction: "Switzerland",
    expect: "matched=true → CRITICAL (owner on list)",
  },
  {
    label: "Clean lists, but a UBO is a PEP",
    legalName: "Sunrise Bakery AG",
    ubos: [{ name: "Maria Politician", ownershipPct: 30, isPEP: true }],
    jurisdiction: "Switzerland",
    expect: "matched=true → CRITICAL (PEP gate)",
  },
  {
    label: "Case-insensitive / whitespace variant",
    legalName: "  BLOCKED   holdings  LTD ",
    ubos: [],
    jurisdiction: "Cyprus",
    expect: "matched=true (normalised match)",
  },
];

function line() {
  console.log("─".repeat(72));
}

async function main() {
  console.log("Sanctions hard-gate direct test  (autoThreshold 98 / reviewThreshold 85)");
  line();
  for (const c of cases) {
    const r = await checkSanctionsPEP(c.legalName, c.ubos, c.jurisdiction);
    const verdict = r.matched
      ? `🔴 MATCHED → CRITICAL  (on "${r.matchedEntity}")`
      : r.reviewRequired
        ? `🟡 REVIEW QUEUE  [${r.reviewCandidates?.map((x) => `${x.name}:${x.score}`).join(", ")}]`
        : "🟢 clear";
    console.log(`• ${c.label}`);
    console.log(`    name="${c.legalName.trim()}"  ubos=[${c.ubos.map((u) => u.name).join(", ") || "—"}]`);
    console.log(`    expect: ${c.expect}`);
    console.log(`    got:    ${verdict}`);
    line();
  }
  console.log(
    "Note: the 🟡 review tier (score 85–97) only fires from a real hits file\n" +
      "      (data/sanctions_hits.json) with an intermediate fuzzy score. The bundled\n" +
      "      demo list returns exact score=100, so demo matches are always CRITICAL.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
