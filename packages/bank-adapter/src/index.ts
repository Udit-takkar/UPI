import { createDb } from "@repo/shared/db";
import { createRedisClient } from "@repo/shared/redis";
import { createKafkaClient, createProducer } from "@repo/shared/kafka";
import { createLogger } from "@repo/shared/logger";
import { createOrgResolver } from "./org-resolver.js";
import { ResilienceLayer, DEFAULT_RESILIENCE_CONFIG } from "./resilience.js";
import { createBankClient } from "./bank-client.js";
import { createBankPool } from "./bank-pool.js";
import { startConsumers } from "./consumer.js";

const logger = createLogger("bank-adapter");

async function main() {
  const db = createDb(
    process.env.DATABASE_URL ??
      "postgres://upi_admin:changeme_dev@localhost:6432/upi_switch",
  );
  const redis = createRedisClient(process.env.REDIS_URL);
  await redis.connect();

  const kafka = createKafkaClient({ clientId: "bank-adapter" });
  const kafkaProducer = await createProducer(kafka);

  const orgResolver = createOrgResolver(db, logger);
  const resilienceLayer = new ResilienceLayer(DEFAULT_RESILIENCE_CONFIG, logger);
  const bankClient = createBankClient(logger);
  const bankPool = createBankPool(
    { db, redis, kafkaProducer },
    resilienceLayer,
    bankClient,
    orgResolver,
    logger,
  );

  const consumers = await startConsumers(kafka, bankPool, db, logger);

  logger.info("Bank adapter started");

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Shutting down — stopping consumers...");
    await consumers.shutdown();

    logger.info("Draining inflight requests...");
    await resilienceLayer.drain(30_000);

    resilienceLayer.destroy();
    await kafkaProducer.disconnect();
    redis.disconnect();

    logger.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal(err, "Failed to start bank adapter");
  process.exit(1);
});
