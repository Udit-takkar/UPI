import { eq, and, lt, sql } from "drizzle-orm";
import { sendMessage } from "@repo/shared/kafka";
import { TOPICS } from "@repo/shared/kafka";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type { Producer } from "kafkajs";
import type pino from "pino";

const POLL_INTERVAL_MS = 120_000;
const MIN_AGE_MS = 180_000;
const BATCH_SIZE = 50;

export function startReconWorker(
  db: Database,
  kafkaProducer: Producer,
  logger: pino.Logger,
) {
  let running = true;

  async function poll() {
    while (running) {
      try {
        const cutoff = new Date(Date.now() - MIN_AGE_MS);

        const deemed = await db
          .select({
            txnId: schema.transactions.txnId,
            rrn: schema.transactions.rrn,
            payerVpa: schema.transactions.payerVpa,
          })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.status, "DEEMED"),
              lt(schema.transactions.updatedAt, cutoff),
            ),
          )
          .limit(BATCH_SIZE);

        for (const txn of deemed) {
          try {
            const payerMapping = await db.query.vpaMappings.findFirst({
              where: eq(schema.vpaMappings.vpaAddress, txn.payerVpa),
            });

            if (!payerMapping) {
              logger.warn({ txnId: txn.txnId }, "Recon: payer VPA mapping not found, skipping");
              continue;
            }

            await sendMessage(kafkaProducer, TOPICS.RECON_STATUS_REQUEST, txn.txnId, {
              txnId: txn.txnId,
              rrn: txn.rrn,
              bankOrgId: payerMapping.bankOrgId,
            });

            await db
              .update(schema.transactions)
              .set({ updatedAt: new Date() })
              .where(eq(schema.transactions.txnId, txn.txnId));

            logger.info({ txnId: txn.txnId, bankOrgId: payerMapping.bankOrgId }, "Recon status query sent");
          } catch (err) {
            logger.error({ txnId: txn.txnId, err }, "Failed to send recon status query");
          }
        }

        if (deemed.length === 0) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      } catch (err) {
        logger.error({ err }, "Recon worker error");
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
