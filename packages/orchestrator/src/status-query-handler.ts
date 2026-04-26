import { eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import { insertPendingCallback } from "./callback.js";
import type pino from "pino";

interface StatusQueryMessage {
  txnId?: string;
  orgTxnId?: string;
  orgId: string;
}

export function createStatusQueryHandler(db: Database, logger: pino.Logger) {
  async function handleStatusQuery(message: StatusQueryMessage): Promise<void> {
    const { txnId, orgTxnId, orgId } = message;

    let txn;
    if (txnId) {
      txn = await db.query.transactions.findFirst({
        where: eq(schema.transactions.txnId, txnId),
      });
    } else if (orgTxnId) {
      txn = await db.query.transactions.findFirst({
        where: eq(schema.transactions.orgTxnId, orgTxnId),
      });
    }

    if (!txn) {
      await db.transaction(async (tx) => {
        await insertPendingCallback(tx, orgId, txnId ?? "", "TXN_STATUS_QUERY_RESP", {
          txnId: txnId ?? null,
          orgTxnId: orgTxnId ?? null,
          status: "NOT_FOUND",
          responseCode: "ZA",
        });
      });
      logger.warn({ txnId, orgTxnId, orgId }, "Status query: transaction not found");
      return;
    }

    await db.transaction(async (tx) => {
      await insertPendingCallback(tx, orgId, txn.txnId, "TXN_STATUS_QUERY_RESP", {
        txnId: txn.txnId,
        orgTxnId: txn.orgTxnId,
        status: txn.status,
        amountPaise: txn.amountPaise.toString(),
        completedAt: txn.completedAt?.toISOString() ?? null,
      });
    });

    logger.info({ txnId: txn.txnId, status: txn.status, orgId }, "Status query response queued");
  }

  return { handleStatusQuery };
}

export type StatusQueryHandler = ReturnType<typeof createStatusQueryHandler>;
