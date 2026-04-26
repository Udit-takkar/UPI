export interface LedgerEntry {
  rrn: string;
  txnId: string;
  operation: "debit" | "credit" | "reversal";
  amountPaise: string;
  ifsc: string;
  accountRef: string;
  status: "SUCCESS" | "FAILED";
  responseCode: string;
  timestamp: Date;
}

const byTxnId = new Map<string, LedgerEntry>();
const rrnToTxnId = new Map<string, string>();

export function recordTransaction(entry: LedgerEntry): void {
  const key = `${entry.txnId}:${entry.operation}`;
  byTxnId.set(key, entry);
  rrnToTxnId.set(entry.rrn, key);
}

export function queryByRrn(rrn: string): LedgerEntry | undefined {
  const key = rrnToTxnId.get(rrn);
  return key ? byTxnId.get(key) : undefined;
}

export function queryByTxnId(txnId: string): LedgerEntry | undefined {
  for (const [key, entry] of byTxnId) {
    if (key.startsWith(txnId)) return entry;
  }
  return undefined;
}

export function getTransactionsInRange(start: Date, end: Date): LedgerEntry[] {
  const results: LedgerEntry[] = [];
  for (const entry of byTxnId.values()) {
    if (entry.timestamp >= start && entry.timestamp < end) {
      results.push(entry);
    }
  }
  return results;
}

export function clearLedger(): void {
  byTxnId.clear();
  rrnToTxnId.clear();
}
