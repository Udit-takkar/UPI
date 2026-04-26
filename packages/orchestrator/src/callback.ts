import { schema } from "@repo/shared/db";
import type { TxnStatus, DrizzleTransaction } from "@repo/shared/db/types";

const TERMINAL_STATES: ReadonlySet<TxnStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "REVERSED",
  "DEEMED",
]);

export function isTerminalState(status: TxnStatus): boolean {
  return TERMINAL_STATES.has(status);
}

export async function insertPendingCallback(
  tx: DrizzleTransaction,
  orgId: string,
  txnId: string,
  callbackType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.pendingCallbacks).values({
    orgId,
    txnId,
    callbackType,
    payload,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: new Date(),
  });
}
