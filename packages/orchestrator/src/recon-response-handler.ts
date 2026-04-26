import { eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type { TxnStatus } from "@repo/shared/db/types";
import { assertTransition } from "@repo/shared/state-machine";
import { applyStateTransition } from "./state-transition.js";
import { insertAuditEntry } from "./audit.js";
import { insertOutboxEvent } from "./outbox.js";
import { insertPendingCallback } from "./callback.js";
import type pino from "pino";

interface ReconStatusResponse {
  txnId: string;
  rrn: string;
  found: boolean;
  operation: string | null;
  bankStatus: string | null;
  amountPaise: string | null;
  responseCode: string;
}

export function createReconResponseHandler(db: Database, logger: pino.Logger) {
  async function handleReconStatusResponse(message: ReconStatusResponse): Promise<void> {
    const txn = await db.query.transactions.findFirst({
      where: eq(schema.transactions.txnId, message.txnId),
    });

    if (!txn || txn.status !== "DEEMED") {
      logger.warn({ txnId: message.txnId, currentStatus: txn?.status }, "Recon response for non-DEEMED txn, skipping");
      return;
    }

    const isTimeout = message.responseCode === "U30" || message.responseCode === "ZS";
    if (isTimeout) {
      logger.info({ txnId: message.txnId }, "Recon: bank unreachable, will retry later");
      return;
    }

    if (!message.found) {
      await transitionDeemedTo(message.txnId, "FAILED", {
        reason: "Bank has no record of transaction",
        reconResponseCode: message.responseCode,
      });
      return;
    }

    if (message.operation === "reversal" && message.bankStatus === "SUCCESS") {
      await transitionDeemedTo(message.txnId, "REVERSED", {
        reason: "Bank confirms reversal succeeded (delayed response)",
        reconResponseCode: message.responseCode,
      });
      return;
    }

    if (message.operation === "credit" && message.bankStatus === "SUCCESS") {
      await transitionDeemedTo(message.txnId, "COMPLETED", {
        reason: "Bank confirms credit went through",
        reconResponseCode: message.responseCode,
      });
      return;
    }

    logger.warn(
      { txnId: message.txnId, operation: message.operation, bankStatus: message.bankStatus },
      "Recon: unresolvable bank status, leaving DEEMED for manual review",
    );
  }

  async function transitionDeemedTo(
    txnId: string,
    toState: TxnStatus,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    assertTransition("DEEMED", toState);

    await db.transaction(async (tx) => {
      await applyStateTransition(tx, txnId, "DEEMED", toState);
      await insertAuditEntry(tx, txnId, "DEEMED", toState, metadata);
      await insertOutboxEvent(tx, txnId, "DEEMED", toState, metadata);

      const txn = await tx.query.transactions.findFirst({
        where: eq(schema.transactions.txnId, txnId),
      });

      if (txn) {
        await insertPendingCallback(tx, txn.pspOrgId, txnId, "TXN_STATUS", {
          txnId,
          orgTxnId: txn.orgTxnId,
          status: toState,
          responseCode: metadata.reconResponseCode ?? null,
          amountPaise: txn.amountPaise.toString(),
          completedAt: new Date().toISOString(),
        });
      }
    });

    logger.info({ txnId, toState }, "Recon resolved DEEMED transaction");
  }

  return { handleReconStatusResponse };
}

export type ReconResponseHandler = ReturnType<typeof createReconResponseHandler>;
