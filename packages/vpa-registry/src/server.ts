import Fastify, { type FastifyInstance } from "fastify";
import { createLogger } from "@repo/shared/logger";
import { createVpaCache } from "./cache/vpa-cache.js";
import { healthRoutes } from "./routes/health.js";
import { resolveRoute } from "./routes/resolve.js";
import { registerRoute } from "./routes/register.js";
import { deregisterRoute } from "./routes/deregister.js";
import type { VpaRegistryDeps } from "./deps.js";

const logger = createLogger("vpa-registry");

export async function createServer(deps: VpaRegistryDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    requestTimeout: 10_000,
    bodyLimit: 1_048_576,
  });

  const vpaCache = createVpaCache(deps.db, deps.redis, logger);

  healthRoutes(app, { deps });
  resolveRoute(app, vpaCache, logger);
  registerRoute(app, deps, vpaCache, logger);
  deregisterRoute(app, deps, vpaCache, logger);

  return app;
}
