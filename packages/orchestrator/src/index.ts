import { createDb } from "@repo/shared/db";
import { createRedisClient } from "@repo/shared/redis";
import { createKafkaClient, createProducer } from "@repo/shared/kafka";
import { createLogger } from "@repo/shared/logger";
import { createTxnProcessor } from "./txn-processor.js";
import { createVpaClient } from "./vpa-client.js";
import { startConsumers } from "./consumer.js";
import { startOutboxPublisher } from "./outbox-publisher.js";
import { startExpiryWorker } from "./expiry-worker.js";
import { createOrgResolver } from "./org-resolver.js";
import { createStatusQueryHandler } from "./status-query-handler.js";
import { startCallbackWorker } from "./callback-worker.js";
import { createReconResponseHandler } from "./recon-response-handler.js";
import { startReconWorker } from "./recon-worker.js";

const logger = createLogger("orchestrator");

async function main() {
  const db = createDb(
    process.env.DATABASE_URL ??
      "postgres://upi_admin:changeme_dev@localhost:6432/upi_switch",
  );
  const redis = createRedisClient(process.env.REDIS_URL);
  await redis.connect();

  const kafka = createKafkaClient({ clientId: "orchestrator" });
  const kafkaProducer = await createProducer(kafka);

  const vpaClient = createVpaClient(
    process.env.VPA_REGISTRY_URL ?? "http://localhost:3002",
    logger,
  );

  const processor = createTxnProcessor(
    { db, redis, kafkaProducer },
    vpaClient,
    logger,
  );

  const orgResolver = createOrgResolver(db, logger);
  const statusQueryHandler = createStatusQueryHandler(db, logger);
  const reconResponseHandler = createReconResponseHandler(db, logger);

  const consumers = await startConsumers(kafka, processor, statusQueryHandler, reconResponseHandler, db, logger);
  const outbox = startOutboxPublisher(db, kafkaProducer, logger);
  const expiry = startExpiryWorker(db, logger);
  const callbackWorker = startCallbackWorker(db, orgResolver, logger);
  const reconWorker = startReconWorker(db, kafkaProducer, logger);

  logger.info("Orchestrator started");

  async function shutdown() {
    logger.info("Shutting down...");
    await consumers.shutdown();
    await outbox.shutdown();
    await expiry.shutdown();
    await callbackWorker.shutdown();
    await reconWorker.shutdown();
    await kafkaProducer.disconnect();
    redis.disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal(err, "Failed to start orchestrator");
  process.exit(1);
});
