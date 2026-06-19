# AMINA Frontend — Compliance Dashboard

Separate from the backend on purpose: **this folder holds NO secrets**. It only knows the
backend base URL and calls its REST endpoints. Build it here with Lovable (React/Vite) or
plain Vite.

## Backend base URL
Local: `http://localhost:8787`. Put it in a frontend env var (e.g. `VITE_API_BASE`).
This is the **only** config the frontend needs — never an API key.

## What to build (judging-aligned)
The rubric rewards UX & Explainability (20%) + Compliance & Safety (20%). Build:

1. **Alert queue** — table of clients with risk flag (LOW/MEDIUM/HIGH/CRITICAL), composite
   score, top contributing signal. Source: `GET /api/demo/alerts`.
2. **Alert detail** — score breakdown per signal (category, direction, magnitude,
   confidence, rationale), the **stage trace** (what ran, in order), and clickable
   **source citations** that reveal the original evidence text.
3. **Human-in-the-loop (stagegate)** — Approve / Reject / Escalate buttons →
   `POST /api/decision`. Case does NOT advance on silence — only on an explicit click.
4. **"Advisory only" badge** — always visible. The AI recommends; a human decides.
5. **Synthetic data badge** — label all Layer 2 data as synthetic.
6. **Cost readout** — calls, total $, $/1,000 analyses. Source: `GET /api/cost`.
7. *(stretch)* **RAG chatbot panel** — "Why was client X flagged?" → calls a backend
   endpoint that returns the grounded answer + citations.

## API contract (shapes)
```ts
// GET /api/demo/alerts
{ alerts: Array<{
    caseName: string;
    baseline: ClientBaseline;       // includes isSynthetic + generatedBy
    composite: {
      compositeScore: number;       // 0-100
      riskFlag: "low"|"medium"|"high"|"critical";
      contributingSignals: SignalScore[];
      neutralSignals: SignalScore[];
      hardGateTriggered: boolean;
      hardGateReason?: string;
    };
    deepAnalysis?: { summary; fullReasoningChain; recommendedAction; allSourcesUsed };
    stageTrace: string[];
    evidenceBySignal: Record<string, Array<{ sourceUrl: string; text: string }>>;
  }>,
  cost: { calls; totalUSD; costPer1000USD; ... }
}

// POST /api/decision  body:
{ clientId: string; actor: string; action: "approve"|"reject"|"escalate"; detail?: string }
```
Full types live in `../backend/src/types.ts`.
