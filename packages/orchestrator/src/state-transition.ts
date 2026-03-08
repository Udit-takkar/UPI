import { eq, and, sql } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import type { DrizzleTransaction, TxnStatus } from "@repo/shared/db/types";

export interface TxnUpdates {
  payerIfsc?: string;
  payeeIfsc?: string;
}

function isTerminal(status: TxnStatus): boolean {
  return ["COMPLETED", "FAILED", "EXPIRED", "REVERSED", "DEEMED"].includes(status);
}

export async function applyStateTransition(
  tx: DrizzleTransaction,
  txnId: string,
  fromState: TxnStatus,
  toState: TxnStatus,
  updates?: TxnUpdates,
): Promise<void> {
  const result = await tx
    .update(schema.transactions)
    .set({
      status: toState,
      version: sql`${schema.transactions.version} + 1`,
      updatedAt: new Date(),
      ...(isTerminal(toState) ? { completedAt: new Date() } : {}),
      ...(updates?.payerIfsc ? { payerIfsc: updates.payerIfsc } : {}),
      ...(updates?.payeeIfsc ? { payeeIfsc: updates.payeeIfsc } : {}),
    })
    .where(
      and(
        eq(schema.transactions.txnId, txnId),
        eq(schema.transactions.status, fromState),
      ),
    )
    .returning({ txnId: schema.transactions.txnId });

  if (result.length === 0) {
    throw new Error(
      `Optimistic lock failed: txn ${txnId} not in state ${fromState}`,
    );
  }
}
