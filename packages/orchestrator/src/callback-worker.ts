import { sql, eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type { OrgResolver } from "./org-resolver.js";
import type pino from "pino";

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 300_000;
const DELIVERY_TIMEOUT_MS = 5_000;

export function startCallbackWorker(
  db: Database,
  orgResolver: OrgResolver,
  logger: pino.Logger,
) {
  let running = true;

  async function poll() {
    while (running) {
      try {
        const callbacks = await db.execute<{
          id: string;
          org_id: string;
          txn_id: string;
          callback_type: string;
          payload: unknown;
          attempt_count: number;
        }>(sql`
          SELECT id, org_id, txn_id, callback_type, payload, attempt_count
          FROM pending_callbacks
          WHERE status = 'PENDING' AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `);

        for (const row of callbacks.rows) {
          try {
            await deliverCallback(row);
          } catch (err) {
            logger.error({ callbackId: row.id, err }, "Failed to process callback");
          }
        }

        if (callbacks.rows.length === 0) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      } catch (err) {
        logger.error({ err }, "Callback worker error");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS * 4));
      }
    }
  }

  async function deliverCallback(row: {
    id: string;
    org_id: string;
    txn_id: string;
    callback_type: string;
    payload: unknown;
    attempt_count: number;
  }): Promise<void> {
    let callbackUrl: string | null;
    try {
      const org = await orgResolver.resolve(row.org_id);
      callbackUrl = org.callbackUrl;
    } catch {
      await markFailed(row.id);
      logger.warn({ callbackId: row.id, orgId: row.org_id }, "Org not found, marking callback failed");
      return;
    }

    if (!callbackUrl) {
      await markFailed(row.id);
      logger.warn({ callbackId: row.id, orgId: row.org_id }, "No callbackUrl configured, marking failed");
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        await db
          .update(schema.pendingCallbacks)
          .set({
            status: "DELIVERED",
            deliveredAt: new Date(),
          })
          .where(eq(schema.pendingCallbacks.id, BigInt(row.id)));

        logger.info({ callbackId: row.id, txnId: row.txn_id }, "Callback delivered");
        return;
      }

      logger.warn(
        { callbackId: row.id, status: response.status },
        "Callback delivery got non-2xx response",
      );
    } catch (err) {
      logger.warn({ callbackId: row.id, err }, "Callback delivery failed");
    }

    const nextAttempt = row.attempt_count + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      await markFailed(row.id);
      logger.warn({ callbackId: row.id }, "Callback exhausted retries, marking failed");
      return;
    }

    const delay = Math.min(BASE_DELAY_MS * 2 ** row.attempt_count, MAX_DELAY_MS);
    await db
      .update(schema.pendingCallbacks)
      .set({
        attemptCount: nextAttempt,
        nextAttemptAt: new Date(Date.now() + delay),
      })
      .where(eq(schema.pendingCallbacks.id, BigInt(row.id)));
  }

  async function markFailed(id: string): Promise<void> {
    await db
      .update(schema.pendingCallbacks)
      .set({ status: "FAILED" })
      .where(eq(schema.pendingCallbacks.id, BigInt(id)));
  }

  const handle = poll();

  return {
    async shutdown() {
      running = false;
      await handle;
    },
  };
}
