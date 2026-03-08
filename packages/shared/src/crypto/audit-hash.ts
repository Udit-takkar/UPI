import { createHash } from "node:crypto";

export function computeAuditHash(entry: {
  txnId: string;
  fromState: string | null;
  toState: string;
  metadata: unknown;
  prevHash: string | null;
}): string {
  const canonical = JSON.stringify([
    entry.txnId,
    entry.fromState,
    entry.toState,
    entry.metadata,
    entry.prevHash,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
