import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createLogger } from "@repo/shared/logger";
import { healthRoutes } from "./routes/health.js";
import { messageRoute } from "./routes/message.js";
import { createOrgCache } from "./hooks/org-cache.js";
import { createAuthPipeline } from "./hooks/auth-pipeline.js";
import type { GatewayDeps } from "./deps.js";

export async function createServer(deps: GatewayDeps): Promise<FastifyInstance> {
  const logger = createLogger("gateway");

  const app = Fastify({
    logger: false,
    requestTimeout: 10_000,
    bodyLimit: 1_048_576,
  });

  const orgCache = createOrgCache(deps.db, logger);
  await orgCache.refresh();

  app.addHook("onClose", () => {
    orgCache.stop();
  });

  app.register(healthRoutes);
  app.register(messageRoute, {
    deps,
    orgCache,
    authPipeline: createAuthPipeline(deps, orgCache, logger),
    logger,
  });

  return app;
}
