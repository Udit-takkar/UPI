import { createDb } from "@repo/shared/db";
import { createRedisClient } from "@repo/shared/redis";
import { createLogger } from "@repo/shared/logger";
import { createServer } from "./server.js";

const logger = createLogger("vpa-registry");

async function main() {
  const db = createDb(
    process.env.DATABASE_URL ??
      "postgres://upi_admin:changeme_dev@localhost:6432/upi_switch",
  );
  const redis = createRedisClient(process.env.REDIS_URL);
  await redis.connect();

  const app = await createServer({ db, redis });

  const port = Number(process.env.PORT ?? 3002);
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "VPA Registry listening");

  async function shutdown() {
    logger.info("Shutting down...");
    await app.close();
    redis.disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal(err, "Failed to start VPA Registry");
  process.exit(1);
});
