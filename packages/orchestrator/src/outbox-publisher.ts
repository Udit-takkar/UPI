import { sql } from "drizzle-orm";
import type { Database } from "@repo/shared/db";
import { sendMessage } from "@repo/shared/kafka";
import type { Topic } from "@repo/shared/kafka";
import { TOPICS } from "@repo/shared/kafka";
import type { Producer } from "kafkajs";
import type pino from "pino";

const POLL_INTERVAL_MS = 100;
const BATCH_SIZE = 100;
const MAX_SEND_RETRIES = 3;

const ROUTABLE_TOPICS = new Set<string>(Object.values(TOPICS));

export function startOutboxPublisher(
  db: Database,
  producer: Producer,
  logger: pino.Logger,
) {
  let running = true;

  async function poll() {
    while (running) {
      try {
        const events = await db.execute<{
          id: number;
          aggregate_id: string;
          event_type: string;
          payload: Record<string, unknown>;
        }>(sql`
          SELECT id, aggregate_id, event_type, payload
          FROM outbox_events
          WHERE published = false
          ORDER BY created_at ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `);

        for (const event of events.rows) {
          if (!running) break;

          const topic = ROUTABLE_TOPICS.has(event.event_type)
            ? (event.event_type as Topic)
            : TOPICS.OUTBOX;

          let sent = false;
          for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt++) {
            try {
              await sendMessage(producer, topic, event.aggregate_id, event.payload);
              sent = true;
              break;
            } catch (err) {
              logger.warn(
                { eventId: String(event.id), topic, attempt, err },
                "Outbox send failed, retrying",
              );
              if (attempt < MAX_SEND_RETRIES - 1) {
                await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
              }
            }
          }

          if (sent) {
            await db.execute(sql`
              UPDATE outbox_events
              SET published = true
              WHERE id = ${event.id}
            `);
          } else {
            logger.error(
              { eventId: String(event.id), topic },
              "Outbox event failed after max retries, skipping to next",
            );
          }
        }

        if (events.rows.length === 0) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      } catch (err) {
        logger.error({ err }, "Outbox publisher error");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS * 4));
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
