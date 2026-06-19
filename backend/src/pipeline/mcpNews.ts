// Evidence retrieval (Layer 1 live source). Wraps EventRegistry news MCP behind a
// single function so the frontend never touches the news API or its key.
// Falls back to the signal's own rawText/sourceUrl when no key is set.
import type { RawSignal } from "../types.js";

export interface Evidence {
  sourceUrl: string;
  text: string;
}

export async function fetchEvidenceViaMCP(signal: RawSignal): Promise<Evidence[]> {
  const key = process.env.EVENTREGISTRY_API_KEY;

  // No key, or non-news signal → use whatever the signal already carries.
  if (!key || signal.sourceType !== "news") {
    if (signal.rawText) {
      return [{ sourceUrl: signal.sourceUrl ?? `signal:${signal.signalId}`, text: signal.rawText }];
    }
    return [];
  }

  // Live EventRegistry query, keyed off the signal text.
  try {
    const res = await fetch("https://eventregistry.org/api/v1/article/getArticles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: key,
        keyword: signal.rawText?.slice(0, 120) ?? "",
        articlesCount: 5,
        resultType: "articles",
        articlesSortBy: "rel",
        dataType: ["news"],
      }),
    });
    if (!res.ok) throw new Error(`EventRegistry ${res.status}`);
    const data = (await res.json()) as {
      articles?: { results?: Array<{ url: string; title: string; body?: string }> };
    };
    const results = data.articles?.results ?? [];
    if (results.length === 0 && signal.rawText) {
      return [{ sourceUrl: signal.sourceUrl ?? `signal:${signal.signalId}`, text: signal.rawText }];
    }
    return results.map((a) => ({
      sourceUrl: a.url,
      text: `${a.title}. ${(a.body ?? "").slice(0, 400)}`,
    }));
  } catch {
    // graceful fallback — never let evidence retrieval crash the pipeline
    if (signal.rawText) {
      return [{ sourceUrl: signal.sourceUrl ?? `signal:${signal.signalId}`, text: signal.rawText }];
    }
    return [];
  }
}
