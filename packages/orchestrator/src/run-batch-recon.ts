import { createDb } from "@repo/shared/db";
import { createLogger } from "@repo/shared/logger";
import { createOrgResolver } from "./org-resolver.js";
import { runBatchReconciliation } from "./batch-reconciler.js";

const logger = createLogger("batch-reconciler");

async function main() {
  const db = createDb(
    process.env.DATABASE_URL ??
      "postgres://upi_admin:changeme_dev@localhost:5432/upi_switch",
  );

  const orgResolver = createOrgResolver(db, logger);

  const windowHours = Number(process.env.RECON_WINDOW_HOURS ?? "4");
  const cycleEnd = new Date();
  const cycleStart = new Date(cycleEnd.getTime() - windowHours * 3600_000);

  await runBatchReconciliation(db, orgResolver, cycleStart, cycleEnd, logger);

  process.exit(0);
}

main().catch((err) => {
  logger.fatal(err, "Batch reconciliation failed");
  process.exit(1);
});
