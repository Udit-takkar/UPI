import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { VpaRegistryDeps } from "../deps.js";

export function healthRoutes(
  app: FastifyInstance,
  opts: { deps: VpaRegistryDeps },
) {
  app.get("/health", async () => ({ status: "ok", service: "vpa-registry" }));

  app.get("/ready", async (_req, reply) => {
    try {
      await opts.deps.redis.ping();
    } catch {
      return reply.status(503).send({ status: "not_ready", reason: "redis" });
    }

    try {
      await opts.deps.db.execute(sql`SELECT 1`);
    } catch {
      return reply.status(503).send({ status: "not_ready", reason: "database" });
    }

    return { status: "ready", service: "vpa-registry" };
  });
}
