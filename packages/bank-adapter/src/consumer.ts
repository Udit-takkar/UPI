import { sql } from "drizzle-orm";
import type { Kafka } from "kafkajs";
import { TOPICS } from "@repo/shared/kafka";
import { createConsumer, runConsumer, type MessageHandler } from "@repo/shared/kafka";
import { createProducer } from "@repo/shared/kafka";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import {
  DebitRequestSchema,
  CreditRequestSchema,
  ReversalRequestSchema,
} from "./kafka-schemas.js";
import type { BankPool } from "./bank-pool.js";
import type pino from "pino";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

async function withIdempotency(
  db: Database,
  eventId: string,
  logger: pino.Logger,
  fn: () => Promise<void>,
): Promise<void> {
  const result = await db
    .insert(schema.processedEvents)
    .values({ eventId })
    .onConflictDoNothing({ target: schema.processedEvents.eventId })
    .returning({ eventId: schema.processedEvents.eventId });

  if (result.length === 0) {
    logger.warn({ eventId }, "Duplicate event, skipping");
    return;
  }

  try {
    await fn();
  } catch (err) {
    await db
      .delete(schema.processedEvents)
      .where(sql`${schema.processedEvents.eventId} = ${eventId}`);
    throw err;
  }
}

async function withRetry(
  fn: () => Promise<void>,
  logger: pino.Logger,
  context: string,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = RETRY_BASE_MS * 2 ** attempt;
      logger.warn({ attempt, delay, context, err }, "Retrying after error");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function createHandler<T>(opts: {
  prefix: string;
  schema: { parse: (data: unknown) => T };
  process: (parsed: T) => Promise<void>;
  label: string;
  db: Database;
  logger: pino.Logger;
}): MessageHandler {
  return async ({ value, key, partition, offset }) => {
    if (!value) return;
    const eventId = `${opts.prefix}:${partition}:${offset}`;
    await withIdempotency(opts.db, eventId, opts.logger, () =>
      withRetry(async () => {
        const parsed = opts.schema.parse(value);
        opts.logger.info({ txnKey: key }, `Processing ${opts.label}`);
        await opts.process(parsed);
      }, opts.logger, `${opts.label} key=${key}`),
    );
  };
}

export async function startConsumers(
  kafka: Kafka,
  bankPool: BankPool,
  db: Database,
  logger: pino.Logger,
) {
  const dlqProducer = await createProducer(kafka);

  const debitConsumer = await createConsumer(kafka, "bank-adapter-debit");
  const creditConsumer = await createConsumer(kafka, "bank-adapter-credit");
  const reversalConsumer = await createConsumer(kafka, "bank-adapter-reversal");

  const debitHandler = createHandler({
    prefix: "ba-debit",
    schema: DebitRequestSchema,
    label: "DEBIT_REQUEST",
    db,
    logger,
    process: (msg) => bankPool.sendDebit(msg),
  });

  const creditHandler = createHandler({
    prefix: "ba-credit",
    schema: CreditRequestSchema,
    label: "CREDIT_REQUEST",
    db,
    logger,
    process: (msg) => bankPool.sendCredit(msg),
  });

  const reversalHandler = createHandler({
    prefix: "ba-reversal",
    schema: ReversalRequestSchema,
    label: "REVERSAL_REQUEST",
    db,
    logger,
    process: (msg) => bankPool.sendReversal(msg),
  });

  await Promise.all([
    runConsumer(debitConsumer, TOPICS.DEBIT_REQUEST, debitHandler, dlqProducer),
    runConsumer(creditConsumer, TOPICS.CREDIT_REQUEST, creditHandler, dlqProducer),
    runConsumer(reversalConsumer, TOPICS.REVERSAL_REQUEST, reversalHandler, dlqProducer),
  ]);

  logger.info("All bank adapter consumers started");

  return {
    async shutdown() {
      await debitConsumer.disconnect();
      await creditConsumer.disconnect();
      await reversalConsumer.disconnect();
      await dlqProducer.disconnect();
    },
  };
}
