import { schema } from "@repo/shared/db";
import type { DrizzleTransaction, TxnStatus } from "@repo/shared/db/types";

export interface OutboundEvent {
  topic: string;
  payload: Record<string, unknown>;
}

export async function insertOutboxEvent(
  tx: DrizzleTransaction,
  txnId: string,
  fromState: TxnStatus | null,
  toState: TxnStatus,
  metadata: Record<string, unknown>,
  outbound?: OutboundEvent,
): Promise<void> {
  await tx.insert(schema.outboxEvents).values({
    aggregateId: txnId,
    eventType: outbound?.topic ?? `TXN_${toState}`,
    payload: outbound?.payload ?? { txnId, fromState, toState, metadata },
  });
}
