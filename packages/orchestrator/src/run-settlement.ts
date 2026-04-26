import { createDb } from "@repo/shared/db";
import { createLogger } from "@repo/shared/logger";
import { createSettlementEngine } from "./settlement-engine.js";

const logger = createLogger("settlement-engine");

async function main() {
  const db = createDb(
    process.env.DATABASE_URL ??
      "postgres://upi_admin:changeme_dev@localhost:5432/upi_switch",
  );

  const windowHours = Number(process.env.SETTLEMENT_WINDOW_HOURS ?? "4");
  const engine = createSettlementEngine(db, logger, { windowHours });

  const batchId = await engine.computeSettlement();
  logger.info({ batchId }, "Settlement complete");

  process.exit(0);
}

main().catch((err) => {
  logger.fatal(err, "Settlement failed");
  process.exit(1);
});
