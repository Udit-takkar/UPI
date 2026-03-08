import { eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import { computeAuditHash } from "@repo/shared/crypto";
import type { DrizzleTransaction, TxnStatus } from "@repo/shared/db/types";

export async function insertAuditEntry(
  tx: DrizzleTransaction,
  txnId: string,
  fromState: TxnStatus | null,
  toState: TxnStatus,
  metadata: Record<string, unknown>,
): Promise<void> {
  const lastAudit = await tx.query.txnAuditLog.findFirst({
    where: eq(schema.txnAuditLog.txnId, txnId),
    orderBy: (log, { desc }) => [desc(log.timestamp)],
  });

  const prevHash = lastAudit?.hash ?? null;

  const hash = computeAuditHash({
    txnId,
    fromState,
    toState,
    metadata,
    prevHash,
  });

  await tx.insert(schema.txnAuditLog).values({
    txnId,
    fromState,
    toState,
    metadata,
    prevHash,
    hash,
  });
}
