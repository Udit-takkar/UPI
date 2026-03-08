import { sql } from "drizzle-orm";
import type { Kafka } from "kafkajs";
import { TOPICS } from "@repo/shared/kafka";
import { createConsumer, runConsumer, type MessageHandler } from "@repo/shared/kafka";
import { createProducer } from "@repo/shared/kafka";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import {
  PayMessageSchema,
  DebitResponseSchema,
  CreditResponseSchema,
} from "./kafka-schemas.js";
import type { TxnProcessor } from "./txn-processor.js";
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
  process: (parsed: T, key: string | null) => Promise<void>;
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
        await opts.process(parsed, key);
      }, opts.logger, `${opts.label} key=${key}`),
    );
  };
}

export async function startConsumers(
  kafka: Kafka,
  processor: TxnProcessor,
  db: Database,
  logger: pino.Logger,
) {
  const dlqProducer = await createProducer(kafka);

  const payConsumer = await createConsumer(kafka, "orchestrator-pay");
  const debitRespConsumer = await createConsumer(kafka, "orchestrator-debit-resp");
  const creditRespConsumer = await createConsumer(kafka, "orchestrator-credit-resp");

  const payHandler = createHandler({
    prefix: "pay",
    schema: PayMessageSchema,
    label: "PAY_REQUEST",
    db,
    logger,
    process: (msg) => processor.handlePayRequest(msg.body, msg.header.orgId),
  });

  const debitRespHandler = createHandler({
    prefix: "debit-resp",
    schema: DebitResponseSchema,
    label: "DEBIT_RESPONSE",
    db,
    logger,
    process: (msg) => processor.handleDebitResponse(msg),
  });

  const creditRespHandler = createHandler({
    prefix: "credit-resp",
    schema: CreditResponseSchema,
    label: "CREDIT_RESPONSE",
    db,
    logger,
    process: (msg) => processor.handleCreditResponse(msg),
  });

  await Promise.all([
    runConsumer(payConsumer, TOPICS.PAY_REQUEST, payHandler, dlqProducer),
    runConsumer(debitRespConsumer, TOPICS.DEBIT_RESPONSE, debitRespHandler, dlqProducer),
    runConsumer(creditRespConsumer, TOPICS.CREDIT_RESPONSE, creditRespHandler, dlqProducer),
  ]);

  logger.info("All orchestrator consumers started");

  return {
    async shutdown() {
      await payConsumer.disconnect();
      await debitRespConsumer.disconnect();
      await creditRespConsumer.disconnect();
      await dlqProducer.disconnect();
    },
  };
}
