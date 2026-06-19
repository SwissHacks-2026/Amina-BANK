# AMINA Challenge — Build Runbook (Execution Order)

> Purpose: what to do, in what order. For design rationale, see the technical architecture spec (`amina-technical-architecture-spec.md`).

---

## Product & Architecture Decisions (locked)

These are decided — don't re-debate during the build.

### D1. Dashboard first, RAG chatbot second
- **Primary build = a compliance dashboard.** The judging rubric rewards "clear alerts, intuitive UI, human-readable reasoning" (UX & Explainability 20%) + "human-in-the-loop validation / approval workflows" (Compliance & Safety 20%) = **40% combined**. A reviewer working a *queue of scored alerts* with approve/reject + citations maps directly onto that. A pure chatbot hides the queue, the scoring, and the audit log.
- **RAG chatbot = secondary panel inside the dashboard**, only if time allows: "Ask why client X was flagged" → retrieves the evidence + `SignalScore[]` → grounded answer with citations. Reuses Stage 2 evidence retrieval, so it's cheap to add.

### D2. Backend + frontend are separate folders
```
/backend    -- TypeScript server. Holds ALL secrets (EventRegistry/news MCP key,
               Voyage key, Anthropic key). Exposes REST endpoints to the frontend.
               Runs: embeddings, MCP news fetch, Stage 2/3 LLM calls, scoring.
/frontend   -- the compliance dashboard UI. NO secrets. Calls /backend over HTTP.
               (Can be Lovable-generated React/Vite, or plain Vite — see D4.)
```
**Why split:** API keys must never reach the browser. The backend is the only place they can live. The frontend only ever sees scored results, never raw keys.

### D3. Secrets handling (.env)
- All keys go in **`backend/.env`** (git-ignored). Commit `backend/.env.example` with empty placeholders.
- Frontend gets **zero** secrets. It only knows the backend's base URL.
- Keys we expect: `EVENTREGISTRY_API_KEY` (news MCP — https://eventregistry.org), `VOYAGE_API_KEY` (embeddings), `ANTHROPIC_API_KEY` (Stage 2/3). Add others (Gemini/OpenAI/Azure) as synthetic-data generators come online.

### D4. Embeddings — ship Option B today, swap to Option A if time
- **Option B (today): `simpleEmbed()`** — hashing-based, runs anywhere, zero key, zero network. Use it to get the *whole* pipeline working end-to-end first.
- **Option A (upgrade): Voyage AI** (`voyage-3-lite`) — real semantic embeddings, but **must run on the backend** (key can't be exposed). Same function signature `embed(text) → number[]`, so it's a drop-in replacement.
- We have a **Lovable** account; Lovable + Supabase edge functions are an acceptable home for the backend embedding endpoint if we go that route. Either way the *contract* the frontend sees is identical.

**Embedding compute & caching plan** (cost/latency matters — Cost Efficiency 20%):
| Target | When computed | Why |
|---|---|---|
| baseline text | once, at client onboarding | never changes → caching avoids recompute |
| risk archetypes (4–6) | once, at app start | fixed reference vectors |
| current signal (new news/desc) | every time a new signal arrives | the only genuinely "live" computation |

```typescript
// cosine similarity is identical regardless of which embedder produced the vectors
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, ai, i) => s + ai * b[i], 0);
  const normA = Math.sqrt(a.reduce((s, ai) => s + ai * ai, 0));
  const normB = Math.sqrt(b.reduce((s, bi) => s + bi * bi, 0));
  return dot / (normA * normB); // 0..1
}

// scoreNarrativeSignal receives PRE-CACHED baseline + archetype vectors,
// and only embeds the incoming signal text live.
async function scoreNarrativeSignal(
  baselineEmbedding: number[],
  archetypeEmbeddings: Record<string, number[]>,
  currentText: string
) {
  const currentEmbedding = await embed(currentText); // only live call
  const baselineSim = cosineSimilarity(baselineEmbedding, currentEmbedding);
  const archetypeMatches = Object.entries(archetypeEmbeddings)
    .map(([name, vec]) => ({ archetype: name, similarity: cosineSimilarity(vec, currentEmbedding) }))
    .sort((a, b) => b.similarity - a.similarity);
  return { baselineSim, archetypeMatches };
}
```

### D5. News MCP (EventRegistry) is the live Stage 1 source
- Credentials received for https://eventregistry.org. Key lives in `backend/.env` as `EVENTREGISTRY_API_KEY`.
- Backend wraps it behind a `fetchEvidenceViaMCP(signal)` endpoint so the frontend never touches the news API directly.

---

## Phase 0 — Right now (within 30 min)

- [ ] **Lock the demo company (hybrid strategy)**
  - For the funding/expansion signal: **Ostium Labs** (Dec 2025, Series A $20M, on-chain derivatives protocol for traditional assets) — use the real news as-is
  - For the business-model-pivot signal: a composite/synthetic scenario — labeled explicitly as synthetic in the slides (same treatment as Layer 2)
  - Once the team agrees, move on

- [ ] **Confirm which MCP data sources are actually connected**
  - Check which of news / sanctions / registry actually work end-to-end (real endpoint, not just "available in theory")
  - Anything not working: drop from the live Stage 1 build, mark as "architecturally supported, not wired up for the demo"

---

## Phase 1 — Build the data foundation (~1–2 hrs)

- [ ] **Generate the Layer 2 synthetic KYC baseline**
  - Feed Ostium Labs' public info to Claude, ask it to produce "what the KYC file would have looked like if AMINA had onboarded them"
  - Fields: legal entity info, declared business description, expected transaction profile, UBOs, risk rating, onboarding date
  - Fix the output as JSON (it gets inserted into the Stage 2 prompt later)

- [ ] **Apply the 4-factor KYC risk rubric to set the baseline `riskRating`**
  - Score across customer / geography / product-service / channel factors (see spec doc section "KYC risk rubric")
  - 0–2 → low, 3–5 → medium, 6+ → high
  - Use this instead of asking Claude to "just assign a risk rating" — explainable and FATF-aligned, scores better on Compliance & Safety

- [ ] **Generate synthetic transaction history** ⚠️ *(this was missing before — needed for AML-pattern signals)*
  - A list of mock transactions: date, amount, counterparty type/jurisdiction, direction
  - Needs to support at least 3 patterns: (a) normal baseline activity, (b) a sudden volume spike inconsistent with history, (c) a dormant period followed by sudden activation
  - This is what actually lets you demo signals #2 (cross-border anomaly), #3 (structuring), #10 (dormancy break) — a text profile alone can't show these

- [ ] **Write one composite pivot scenario**
  - Two concrete text snippets: onboarding-time description vs. "current" description (for the embedding comparison)
  - Store the "synthetic example" label alongside it

- [ ] **Prepare a risk archetype text set** (4–6 entries)
  - e.g. high-leverage crypto derivatives, shell company with no activity, relocation to a sanctioned jurisdiction, unexplained volume surge

---

## Phase 2 — Pipeline code (~2–3 hrs)

Build in this order; keep each step independently testable.

- [ ] **2-1. Embedding functions**
  - baseline ↔ current cosine similarity
  - current ↔ each archetype similarity (return the highest match + which archetype)
  - implementation ready to copy: `simpleEmbed()` (zero-setup, hashing-based, client-side) — see spec doc section 3.3; swap for Voyage AI later if there's time for a backend

- [ ] **2-2. Rule-based numeric diff functions**
  - transaction volume, dormancy→activity, funding amount — plain comparison functions, no LLM needed

- [ ] **2-3. Hard gate (sanctions/PEP)**
  - MCP sanctions lookup → exact match triggers immediate critical, skips everything below

- [ ] **2-4. Stage 2 — LLM classification (Haiku 4.5)**
  - Input: baseline, current signal, similarity scores, retrieved evidence text from MCP
  - Fixed output JSON: `{ direction: risk-increasing | neutral-update | positive, magnitude, rationale, source_citations, suggested_action, confidence }`
  - **This is priority #1 — nothing else matters if this isn't working**

- [ ] **2-5. Weighted scoring engine**
  - Handle each direction differently (only risk-increasing adds to the composite score; neutral-update triggers a separate threshold-refresh workflow; positive softens the score)
  - Use the confidence-adjusted formula: `magnitude × weight × confidence`, not just `magnitude × weight`
  - Composite score → Low / Medium / High

- [ ] **2-5b. Calibrate `SIGNAL_WEIGHTS` against README's 10 reference scenarios**
  - Run each of README's "Use Cases" rows through the scoring engine
  - Nudge individual weights until the output severity matches README's "Recommended Action" column (e.g. domain change should stay low-severity, structuring should come out high-severity)
  - Note in the pitch that weights are also loosely aligned to FATF/Basel risk-factor tiers, not picked arbitrarily

- [ ] **2-6. Stage 3 — deep analysis (Sonnet 4.6)**
  - Only called for cases escalated to High
  - Synthesizes multiple sources into a detailed report

---

## Phase 3 — UI (~1–2 hrs, can run in parallel with Phase 2)

- [ ] Adapt the existing SIX RM dashboard code into a compliance-toned version
  - "Advisory only" badge is mandatory
  - Clicking a source citation shows the original text
  - Reuse the similarity visualization widget style from earlier

- [ ] Add a cost readout (call counts/tokens per stage → live $ conversion)

---

## Phase 4 — Integration + cost table (~1 hr)

- [ ] End-to-end test with both cases (Ostium Labs + the composite pivot scenario)
- [ ] Fill in the cost-per-1,000-analyses estimate table (spec doc section 8)
- [ ] Self-check against the 5 judging criteria

---

## Phase 5 — Demo rehearsal

- [ ] 3-minute demo script: (1) hard gate instant block → (2) Ostium Labs real funding news as a neutral-update example → (3) composite pivot case showing risk-increasing + full 3-stage escalation → (4) close on the cost table
- [ ] Explicitly say once during the pitch that synthetic vs. real data is clearly separated (builds compliance credibility)

---

## If you're running out of time, cut in this order

Cut from the bottom up:

1. Stage 2 LLM classification — **never cut** (directly tied to 45% of judging)
2. Hard gate — cheap to build, high payoff, don't skip
3. Weighted scoring — even a simple version needs to exist
4. UI polish — lower priority than functionality
5. Stage 3 deep analysis — if short on time, it's okay to say "architecture supports it, demo only shows one escalated case"
6. Cost table — can be filled in fast in the last 30 minutes
