import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createLogger } from "@repo/shared/logger";
import { AppError, RateLimitError } from "@repo/shared/errors";
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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RateLimitError) {
      return reply
        .status(429)
        .header("Retry-After", Math.ceil(error.retryAfterMs / 1000))
        .send({ code: error.code, message: error.message });
    }

    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ code: error.code, message: error.message });
    }

    if (error instanceof Error && "validation" in error) {
      return reply
        .status(400)
        .send({ code: "VALIDATION_ERROR", message: error.message });
    }

    logger.error({ err: error }, "Unhandled error");
    return reply
      .status(500)
      .send({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });

  app.register(healthRoutes, { deps });
  app.register(messageRoute, {
    deps,
    orgCache,
    authPipeline: createAuthPipeline(deps, orgCache, logger),
    logger,
  });

  return app;
}
