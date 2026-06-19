# AMINA — Research & Benchmark Pass

> What our service is, who has built similar things, what we can borrow, and how to
> keep hunting GitHub for proven approaches. Compiled 2026-06-19.

---

## 1. What our service IS (one-paragraph pitch)

A **continuous KYC-drift detector with tiered reasoning**. We watch *public* real-time
signals (news, sanctions, registry/ownership, funding, domain changes) and compare them
against each client's *internal* onboarding KYC baseline (synthetic, for the demo). When
a client's real-world activity quietly diverges from what they declared at onboarding, we
flag the drift. Cost-awareness is structural: a cheap, keyless **Layer 1** (rules +
embeddings) filters everything; only flagged cases escalate to an **LLM Layer 2** (Haiku)
for a plain-English, cited explanation; only HIGH-risk cases reach **Layer 3** (Sonnet)
for a full escalation report. A compliance officer approves/rejects every decision, and
everything is logged for audit.

---

## 2. Closest prior art (benchmark these)

| Repo / Dataset | Why it matters to us | What to borrow |
|---|---|---|
| **[vyayasan/kyc-analyst](https://github.com/vyayasan/kyc-analyst)** | **Almost our exact concept.** KYC/AML automation on Claude, deterministic risk scoring, human-in-the-loop gates, public-source-first, immutable audit trail. | Their **4-factor weighted model** (Geographic 30% / Customer 35% / Product 25% / Channel 10%, bands LOW 0–20 … CRITICAL 81–100) — almost identical to our KYC rubric. **Stagegate consent pattern** (advance only on explicit `proceed`/`confirm`, never on silence). **Immutable numbered case folders** with timestamped audit trail. Public sources list: OFAC SDN, UN, EU, UK HMT, OpenSanctions, Companies House, ICIJ Offshore Leaks, SEC EDGAR. |
| **[jube-home/aml-fraud-transaction-monitoring](https://github.com/jube-home/aml-fraud-transaction-monitoring)** | Production-grade real-time AML transaction monitoring. | **Behavioral feature abstraction** — derive velocity / volume / geolocation as explainable features (feeds our `ruleDiff.ts`). **Dual-layer = rules (fast, deterministic) + ML (adaptive)** — same shape as our Layer 1 / Layer 2 split. Velocity & aggregation counters for thresholds. |
| **[An Agentic LLM Framework for Adverse Media Screening (paper, Mar 2026)](https://www.researchgate.net/publication/401417566_An_Agentic_LLM_Framework_for_Adverse_Media_Screening_in_AML_Compliance)** | Directly the LLM+RAG adverse-media pattern we want in Stage 2. | The **Adverse Media Index (AMI)** scoring idea: LLM agent searches → retrieves → scores each subject. Mirrors our embedding-gate → Haiku-classify flow. |
| **[NadirRouter/NadirClaw](https://github.com/NadirRouter/NadirClaw)** + **[nandth/model-router-ai](https://github.com/nandth/model-router-ai)** | Cost-aware LLM cascade / escalation — our Cost Efficiency story (20% of judging). | Classify prompts in ~10ms via **sentence embeddings**, three-tier routing with **configurable score thresholds**, escalate only on low confidence. Validates our cheap-filter-first design. |
| **["Cost-Saving LLM Cascades with Early Abstention" (arXiv 2502.09054)](https://arxiv.org/pdf/2502.09054)** | Theory behind cascades. | **Early abstention** — let a cheap stage say "I don't know" and stop, instead of always escalating. Maps to our `neutral_update` + low-confidence path. |

---

## 3. Datasets for Layer 2 (synthetic tx history)

We're generating synthetic data with multiple models, but these give us **realistic
typologies to imitate** and a **benchmark to cite**:

| Dataset | Size / nature | Use for us |
|---|---|---|
| **[SAML-D (Kaggle)](https://www.kaggle.com/datasets/berkanoztas/synthetic-transaction-monitoring-dataset-aml)** | 9.5M tx, 28 typologies (11 normal / 17 suspicious), high-risk countries & payment types. | The **typology catalog** — fan-in/fan-out, smurfing, cycle, etc. Make our generators reproduce these patterns so demos look real. |
| **[IBM AMLSim](https://github.com/IBM/AMLSim)** | Agent-based simulator injecting laundering motifs (fan-in/out, smurfing). | Reference for **how to inject** a known-bad pattern into otherwise-normal activity (our spike & dormancy-break scenarios). |
| **[SynthAML / Nature Sci Data 2023](https://www.nature.com/articles/s41597-023-02569-2)** | 20k alerts, 16M tx, built on real Danish bank data. | Cite as the **"this is how synthetic AML benchmarks are validated"** reference in the pitch. |

> Note the realistic base rate: SAML-D is only **0.10% suspicious**. Our demo should keep
> suspicious cases rare among the synthetic clients — a wall of red flags reads as fake.

---

## 4. How to keep hunting GitHub (Google dorks)

Paste these into Google — `site:github.com` + intent keywords beats GitHub's own search:

```
site:github.com KYC drift detection
site:github.com AML transaction monitoring LLM
site:github.com adverse media screening RAG
site:github.com sanctions screening opensanctions
site:github.com "perpetual KYC" OR "pKYC"
site:github.com LLM cascade router cost aware
site:github.com beneficial ownership change detection
# find datasets:
site:kaggle.com AML synthetic transactions
# find papers with code:
site:paperswithcode.com anti money laundering
```

Refinements that work well:
- Add `stars:>50` mentally by sorting GitHub results by stars after you land there.
- Append a **language**: `... github python`, `... github typescript`.
- Search the **technique name**, not the domain: `entity resolution`, `name matching
  fuzzy sanctions`, `concept drift detection river` (the `river` library does online
  drift detection — useful for the "KYC drift" framing).
- For UI inspiration: `site:github.com compliance dashboard react` / `alert triage UI`.

---

## 5. What this changes in OUR build (action items)

1. **Adopt kyc-analyst's 4-factor weights for the baseline `riskRating`** (Geo 30 /
   Customer 35 / Product 25 / Channel 10). This is FATF-aligned *and* now has a public
   reference implementation we can cite. Already noted in the runbook KYC rubric step.
2. **Add a stagegate consent pattern** to the dashboard approve/reject: the case does not
   advance to "closed/SAR-filed" on silence — only on an explicit analyst action. Strong
   Compliance & Safety point.
3. **Make `ruleDiff.ts` features explicit behavioral features** (velocity, volume,
   geo-deviation) à la Jube — already the shape of our anomaly checks; just label them
   that way in the UI for explainability.
4. **Keep the suspicious base-rate low** in synthetic data (~ a handful of drifting
   clients among ~20–30 normal ones), per SAML-D's 0.1%.
5. **Cite the cascade papers** in the cost section: early-abstention + embedding-gate is a
   recognized, published cost-reduction pattern, not something we invented ad hoc.

---

## Sources
- https://github.com/vyayasan/kyc-analyst
- https://github.com/jube-home/aml-fraud-transaction-monitoring
- https://www.researchgate.net/publication/401417566_An_Agentic_LLM_Framework_for_Adverse_Media_Screening_in_AML_Compliance
- https://github.com/NadirRouter/NadirClaw
- https://github.com/nandth/model-router-ai
- https://arxiv.org/pdf/2502.09054
- https://www.kaggle.com/datasets/berkanoztas/synthetic-transaction-monitoring-dataset-aml
- https://github.com/IBM/AMLSim
- https://www.nature.com/articles/s41597-023-02569-2
