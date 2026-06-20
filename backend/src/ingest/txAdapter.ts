// Adapter: synthetic per-client transaction history (data/synthetic_transactions.json,
// produced by data/generators/genTransactions.ts) → { clientId → TransactionRecord[] }.
// Real bank transaction data is private, so this is synthetic but anchored to each client's
// real KYC baseline (expected volume + jurisdiction) and the AML-typology thresholds.
import { existsSync, readFileSync } from "node:fs";
import type { TransactionRecord } from "../types.js";

const DEFAULT_PATH = new URL("../../../data/synthetic_transactions.json", import.meta.url);

/** Returns { clientId → TransactionRecord[] }. Empty if the file hasn't been generated. */
export function loadTransactions(path: URL | string = DEFAULT_PATH): Record<string, TransactionRecord[]> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, TransactionRecord[]>;
}
