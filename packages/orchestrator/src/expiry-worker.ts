import { sql, and, inArray, lt, eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type { TxnStatus } from "@repo/shared/db/types";
import { insertAuditEntry } from "./audit.js";
import { insertOutboxEvent } from "./outbox.js";
import type pino from "pino";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 200;

const EXPIRABLE_STATES: TxnStatus[] = ["RECEIVED", "VPA_RESOLVED"];

export function startExpiryWorker(db: Database, logger: pino.Logger) {
  let running = true;

  async function poll() {
    while (running) {
      try {
        const expired = await db
          .select({
            txnId: schema.transactions.txnId,
            status: schema.transactions.status,
          })
          .from(schema.transactions)
          .where(
            and(
              lt(schema.transactions.expiresAt, new Date()),
              inArray(schema.transactions.status, EXPIRABLE_STATES),
            ),
          )
          .limit(BATCH_SIZE);

        for (const { txnId, status: currentStatus } of expired) {
          try {
            await db.transaction(async (tx) => {
              const result = await tx
                .update(schema.transactions)
                .set({
                  status: "EXPIRED",
                  version: sql`${schema.transactions.version} + 1`,
                  updatedAt: new Date(),
                  completedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.transactions.txnId, txnId),
                    inArray(schema.transactions.status, EXPIRABLE_STATES),
                  ),
                )
                .returning({ txnId: schema.transactions.txnId });

              if (result.length === 0) return;

              const metadata = { reason: "Transaction expired" };
              await insertAuditEntry(tx, txnId, currentStatus, "EXPIRED", metadata);
              await insertOutboxEvent(tx, txnId, currentStatus, "EXPIRED", metadata);
            });

            logger.info({ txnId, fromState: currentStatus }, "Transaction expired");
          } catch (err) {
            logger.error({ txnId, err }, "Failed to expire transaction");
          }
        }

        if (expired.length === 0) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      } catch (err) {
        logger.error({ err }, "Expiry worker error");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS * 2));
      }
    }
  }

  const handle = poll();

  return {
    async shutdown() {
      running = false;
      await handle;
    },
  };
}
