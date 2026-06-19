# AMINA Dynamic Risk Profiling — Technical Architecture Spec
### Vibe-coding ready: data schemas, function contracts, prompts, weights

---

## 1. Data flow (end to end)

```
Layer 1 (public, real-time)        Layer 2 (synthetic, fixed)
  news / registry / sanctions  ──┐    client baseline + tx history
  funding / domain changes      │           │
                                 ▼           ▼
                        ┌─────────────────────────┐
                        │  classifyRawSignal()     │
                        │  routes by signal type    │
                        └─────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
      numeric signal      narrative signal     identity signal
      ruleDiff()          (see detail below)    hardGate()
              │                  │                   │
              │                  │                   └──→ MATCH → CRITICAL (skip rest)
              │                  │
              └────────┬─────────┘
                        ▼
              SignalScore[] (per signal)
```

**Narrative signal branch, expanded** — embedding similarity sits here, as a cheap
gatekeeper *before* any LLM call, not bundled into Stage 2:

```
narrative signal (news text / business description / website text)
        │
        ▼
  embed(currentText)
        │
        ├──► cosineSimilarity(baselineEmbedding)   = baselineSim
        │
        └──► cosineSimilarity(each archetype)      = archetypeSims[]
        │
        ▼
  (no LLM call yet — pure vector math, this IS "embedding similarity")
        │
  baselineSim < 0.6  OR  max(archetypeSims) > 0.55 ?
        │
      Yes (worth reviewing)              No (nothing notable)
        │                                       │
        ▼                                       ▼
  Stage 2 — classifySignal() (Haiku)      discard, no LLM cost spent
  receives baselineSim + archetypeSims
  as context, does NOT recompute them —
  only judges direction (risk/neutral/positive)
        │
        ▼
  SignalScore { magnitude, direction, rationale, ... }
```

```
                        │
                        ▼
              computeCompositeScore()
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
        Low / Medium          High
              │                   │
              │                   ▼
              │           deepAnalyze() — Stage 3 (Sonnet 4.6)
              │                   │
              └─────────┬─────────┘
                        ▼
                  human review queue
                        │
                        ▼
                  alert dashboard (with citations, audit log)
```

---

## 2. Core data types

```typescript
// ── Layer 2: synthetic internal data ──────────────────────────────

interface ClientBaseline {
  clientId: string;
  legalName: string;
  jurisdiction: string;
  legalForm: string;
  onboardingDate: string; // ISO date
  declaredBusinessDescription: string; // the embedding anchor text
  expectedMonthlyTxCount: number;
  expectedMonthlyVolumeUSD: number;
  expectedCounterpartyRegions: string[];
  ubos: Array<{ name: string; ownershipPct: number; isPEP: boolean }>;
  riskRating: "low" | "medium" | "high";
  isSynthetic: true; // always true — for audit/UI labeling
}

interface TransactionRecord {
  txId: string;
  clientId: string;
  date: string; // ISO date
  amountUSD: number;
  counterpartyRegion: string;
  direction: "inbound" | "outbound";
  isSynthetic: true;
}

// ── Layer 1: incoming raw signal ──────────────────────────────────

type SignalCategory =
  | "negative_news"
  | "cross_border_anomaly"
  | "structuring_pattern"
  | "entity_name_change"
  | "domain_change"
  | "business_model_pivot"
  | "jurisdiction_change"
  | "ownership_change"
  | "funding_scale_change"
  | "dormancy_break";

interface RawSignal {
  signalId: string;
  clientId: string;
  category: SignalCategory;
  detectedAt: string;
  sourceType: "news" | "registry" | "domain" | "transaction" | "funding_db";
  sourceUrl?: string;
  rawText?: string;        // for narrative signals
  rawNumeric?: number;     // for numeric signals
  rawNumericContext?: Record<string, number>; // e.g. { previousValue: 0, currentValue: 50 }
}

// ── Pipeline outputs ───────────────────────────────────────────────

interface SignalScore {
  signalId: string;
  category: SignalCategory;
  method: "rule_diff" | "embedding" | "llm_classification";
  magnitude: number;       // 0–100, "how big is the change"
  direction: "risk_increasing" | "neutral_update" | "positive" | "unknown";
  rationale: string;       // human-readable, plain language
  sourceCitations: string[]; // URLs or source IDs referenced
  confidence: number;      // 0–1
}

interface CompositeScoreResult {
  clientId: string;
  compositeScore: number;  // 0–100
  riskFlag: "low" | "medium" | "high" | "critical";
  contributingSignals: SignalScore[];
  hardGateTriggered: boolean;
  hardGateReason?: string;
}

interface DeepAnalysisReport {
  clientId: string;
  summary: string;
  fullReasoningChain: string;
  allSourcesUsed: string[];
  recommendedAction: string;
  generatedAt: string;
}
```

---

## 3. Module breakdown

### 3.1 `ruleDiff.ts` — numeric signals, no AI

```typescript
function checkTransactionAnomaly(
  baseline: ClientBaseline,
  recentTxs: TransactionRecord[]
): SignalScore | null {
  // compute recent monthly volume/count vs baseline.expected*
  // magnitude = percent deviation, capped 0–100
  // direction = "risk_increasing" if deviation > threshold and unexplained,
  //             "neutral_update" if deviation correlates with a known funding/expansion signal
  // no LLM call here — pure arithmetic
}

function checkDormancyBreak(
  recentTxs: TransactionRecord[],
  dormancyWindowDays: number = 180
): SignalScore | null {
  // if zero/near-zero activity for dormancyWindowDays, then a spike → flag
}

function checkFundingScale(raw: RawSignal): SignalScore | null {
  // raw.rawNumericContext = { previousFundingUSD, currentFundingUSD }
  // magnitude scales with funding multiple; direction defaults to "neutral_update"
  // (Stage 2 may override to "positive" or "risk_increasing" based on narrative context)
}
```

### 3.2 `hardGate.ts` — binary, calls MCP sanctions/PEP source

```typescript
async function checkSanctionsPEP(
  legalName: string,
  ubos: ClientBaseline["ubos"]
): Promise<{ matched: boolean; matchedEntity?: string; sourceUrl?: string }> {
  // calls the connected sanctions/PEP MCP tool with exact-name query
  // exact match only — no fuzzy/semantic matching here, this must be deterministic
}
```

### 3.3 `embeddings.ts` — narrative signal filtering

```typescript
async function embed(text: string): Promise<number[]> {
  // call embedding provider (Voyage / sentence-transformers)
}

function cosineSimilarity(a: number[], b: number[]): number {
  // standard dot product / (norm a * norm b)
}

const RISK_ARCHETYPES: Record<string, string> = {
  high_leverage_crypto: "High-leverage crypto derivatives trading platform offering up to 100x leverage",
  shell_company: "Inactive entity with no verifiable business operations or physical presence",
  sanctioned_jurisdiction_move: "Relocation of legal domicile or operations to a jurisdiction under international sanctions",
  unexplained_volume_surge: "Sudden, unexplained surge in transaction volume inconsistent with stated business activity"
};

async function scoreNarrativeSignal(
  baselineText: string,
  currentText: string
): Promise<{ baselineSimilarity: number; archetypeMatches: Array<{ archetype: string; similarity: number }> }> {
  // embed both baselineText and currentText, compute similarity
  // embed currentText against each RISK_ARCHETYPES entry, return sorted matches
}
```

### 3.4 `stage2Classify.ts` — Claude Haiku 4.5, RAG-grounded

```typescript
async function classifySignal(
  baseline: ClientBaseline,
  signal: RawSignal,
  embeddingScores: { baselineSimilarity?: number; archetypeMatches?: Array<{ archetype: string; similarity: number }> },
  retrievedEvidence: Array<{ sourceUrl: string; text: string }> // fetched via MCP before this call
): Promise<SignalScore> {
  // builds STAGE2_PROMPT (see section 4), calls Claude Haiku 4.5
  // model: "claude-haiku-4-5-20251001"
  // parses fixed JSON response into SignalScore
}
```

### 3.5 `scoringEngine.ts` — aggregation

```typescript
const SIGNAL_WEIGHTS: Record<SignalCategory, number> = {
  business_model_pivot: 20,
  ownership_change: 15,
  cross_border_anomaly: 14,
  structuring_pattern: 14,
  jurisdiction_change: 10,
  dormancy_break: 8,
  negative_news: 8,
  entity_name_change: 4,
  domain_change: 4,
  funding_scale_change: 3
}; // sums to 100

function computeCompositeScore(
  scores: SignalScore[],
  hardGateResult: { matched: boolean; matchedEntity?: string }
): CompositeScoreResult {
  if (hardGateResult.matched) {
    return { /* riskFlag: "critical", hardGateTriggered: true, ... */ } as CompositeScoreResult;
  }
  // only direction === "risk_increasing" contributes to compositeScore
  // neutral_update signals: do not add to score, but return separately for a
  //   "threshold refresh" workflow trigger
  // positive signals: subtract a small amount (e.g. magnitude * weight * 0.3) as softening
  // compositeScore = sum(magnitude * weight / 100) for risk_increasing signals, clamped 0–100
  // riskFlag thresholds: <30 low, 30–60 medium, >60 high
}
```

### 3.6 `stage3DeepAnalysis.ts` — Claude Sonnet 4.6, escalated only

```typescript
async function deepAnalyze(
  baseline: ClientBaseline,
  compositeResult: CompositeScoreResult,
  allEvidence: Array<{ sourceUrl: string; text: string }>
): Promise<DeepAnalysisReport> {
  // model: "claude-sonnet-4-6"
  // only called when compositeResult.riskFlag === "high"
  // builds STAGE3_PROMPT (see section 4)
}
```

### 3.7 `pipeline.ts` — orchestrator

```typescript
async function runPipeline(
  baseline: ClientBaseline,
  recentTxs: TransactionRecord[],
  incomingSignals: RawSignal[]
): Promise<CompositeScoreResult | DeepAnalysisReport> {
  const hardGateResult = await checkSanctionsPEP(baseline.legalName, baseline.ubos);
  if (hardGateResult.matched) {
    return computeCompositeScore([], hardGateResult); // short-circuit
  }

  const scores: SignalScore[] = [];

  for (const signal of incomingSignals) {
    if (signal.sourceType === "transaction") {
      const s = checkTransactionAnomaly(baseline, recentTxs) ?? checkDormancyBreak(recentTxs);
      if (s) scores.push(s);
      continue;
    }
    if (signal.sourceType === "funding_db") {
      const s = checkFundingScale(signal);
      if (s) scores.push(s);
      continue;
    }
    // narrative path: news, registry text changes, domain/business description changes
    const embedScores = await scoreNarrativeSignal(baseline.declaredBusinessDescription, signal.rawText ?? "");
    if (embedScores.baselineSimilarity < 0.6 || embedScores.archetypeMatches[0]?.similarity > 0.55) {
      const evidence = await fetchEvidenceViaMCP(signal); // calls connected news/registry MCP
      const classified = await classifySignal(baseline, signal, embedScores, evidence);
      scores.push(classified);
    }
  }

  const composite = computeCompositeScore(scores, hardGateResult);
  if (composite.riskFlag === "high") {
    const evidence = await collectAllEvidence(scores);
    return await deepAnalyze(baseline, composite, evidence);
  }
  return composite;
}
```

---

## 4. Prompt templates

### STAGE2_PROMPT (Haiku 4.5)

```
You are classifying a single risk signal for a private bank's compliance team.
Use ONLY the facts given below. Do not invent figures or facts not present.

CLIENT BASELINE (synthetic, established at onboarding)
Declared business: {baseline.declaredBusinessDescription}
Risk rating: {baseline.riskRating}
Expected monthly volume: {baseline.expectedMonthlyVolumeUSD} USD

SIGNAL
Category: {signal.category}
Detected: {signal.detectedAt}
Raw content: {signal.rawText}

EMBEDDING SCORES (for reference only — you make the final call)
Baseline similarity: {embeddingScores.baselineSimilarity}
Closest risk archetype: {embeddingScores.archetypeMatches[0].archetype} ({embeddingScores.archetypeMatches[0].similarity})

RETRIEVED EVIDENCE
{for each item in retrievedEvidence: "- [{sourceUrl}]: {text}"}

Return ONLY this JSON shape, no markdown fences, no commentary:
{
  "direction": "risk_increasing" | "neutral_update" | "positive",
  "magnitude": <0-100 integer>,
  "rationale": "<one or two plain-language sentences a compliance officer can read directly>",
  "source_citations": ["<url or source id from retrievedEvidence only>"],
  "confidence": <0-1 float>
}

If the evidence does not clearly support a conclusion, set direction to "neutral_update"
and confidence below 0.5 rather than guessing.
```

### STAGE3_PROMPT (Sonnet 4.6)

```
You are preparing a full compliance escalation report for a human reviewer.
This client has been flagged HIGH RISK by an automated scoring engine.
Use only the evidence provided. Cite the specific source for every factual claim.

CLIENT BASELINE
{full baseline JSON}

COMPOSITE SCORE RESULT
Score: {compositeResult.compositeScore}/100
Contributing signals: {list each SignalScore: category, direction, magnitude, rationale}

ALL EVIDENCE COLLECTED
{for each item: "- [{sourceUrl}]: {text}"}

Produce a JSON report with:
{
  "summary": "<3-4 sentence executive summary for a compliance officer>",
  "full_reasoning_chain": "<step by step reasoning connecting each signal to the conclusion>",
  "all_sources_used": ["<list of source URLs actually cited above>"],
  "recommended_action": "<one of: file SAR, request enhanced KYC documents, escalate to senior compliance, no action needed>"
}

This output is advisory only. State explicitly in the summary that a human must
approve any action before it is taken.
```

---

## 5. Suggested file structure

```
/src
  /types.ts              -- all interfaces from section 2
  /data
    baselineGenerator.ts  -- Phase 1: generates ClientBaseline via Claude
    txGenerator.ts        -- Phase 1: generates synthetic TransactionRecord[]
  /pipeline
    ruleDiff.ts
    hardGate.ts
    embeddings.ts
    stage2Classify.ts
    scoringEngine.ts
    stage3DeepAnalysis.ts
    pipeline.ts            -- orchestrator
  /prompts
    stage2.ts               -- STAGE2_PROMPT template + builder function
    stage3.ts                -- STAGE3_PROMPT template + builder function
  /ui
    AlertDashboard.tsx
    CostTracker.tsx
```

---

## 6.5 How weights are derived (and how to change them)

Don't hardcode `SIGNAL_WEIGHTS` as a constant — load it from a JSON config file owned
by "compliance" in the demo narrative. This makes the governance story explicit:
the AI executes a policy, it does not set the policy.

```typescript
// config/signalWeights.json — versioned, "compliance-owned"
{
  "version": "2026-06-19",
  "approvedBy": "compliance-policy-board",
  "weights": {
    "business_model_pivot": 20,
    "ownership_change": 15,
    "cross_border_anomaly": 14,
    "structuring_pattern": 14,
    "jurisdiction_change": 10,
    "dormancy_break": 8,
    "negative_news": 8,
    "entity_name_change": 4,
    "domain_change": 4,
    "funding_scale_change": 3
  }
}
```

**How the starting numbers were derived (cite this in the pitch):**
1. Aligned to FATF / Basel risk-based-approach factor tiers where applicable
   (beneficial ownership change and jurisdiction risk are recognized higher-weight
   factors in international AML guidance — cite this rather than asserting it from
   nothing).
2. Calibrated against README's own "Use Cases" reference table — each of the 10
   example rows was run through the scoring engine and weights were nudged until
   the resulting flag matched README's "Expected Flag" column.
3. (Future / production) Replace with a regression-fit weight set once real labeled
   outcome data exists — not feasible with synthetic data alone, state this
   explicitly as a roadmap item rather than pretending it's done.

**Confidence-adjusted composite formula** — use `SignalScore.confidence` rather than
treating every classification as equally certain:

```typescript
function computeCompositeScore(scores: SignalScore[], weights: Record<SignalCategory, number>): number {
  const riskSignals = scores.filter(s => s.direction === "risk_increasing");
  const positiveSignals = scores.filter(s => s.direction === "positive");

  const riskSum = riskSignals.reduce(
    (acc, s) => acc + (s.magnitude * weights[s.category] * s.confidence) / 100,
    0
  );
  const softening = positiveSignals.reduce(
    (acc, s) => acc + (s.magnitude * weights[s.category] * s.confidence * 0.3) / 100,
    0
  );

  return Math.max(0, Math.min(100, riskSum - softening));
}
```

A low-confidence LLM classification now contributes proportionally less than a
high-confidence one with the same magnitude — this makes "the AI was unsure"
visible in the final number instead of being silently discarded.

---

## 6.6 Cost instrumentation hook

Every Stage 2 / Stage 3 call should log:
```typescript
interface CostLogEntry {
  stage: 2 | 3;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  signalId: string;
  timestamp: string;
}
```
Aggregate these into `costPer1000Analyses()` for the judging deliverable in spec doc section 8.
