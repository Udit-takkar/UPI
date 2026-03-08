import type { FastifyInstance } from "fastify";
import type { VpaCache } from "../cache/vpa-cache.js";
import type pino from "pino";

export function resolveRoute(
  app: FastifyInstance,
  vpaCache: VpaCache,
  logger: pino.Logger,
) {
  app.post<{ Body: { vpaAddress: string } }>(
    "/internal/vpa/resolve",
    async (request, reply) => {
      const { vpaAddress } = request.body;

      if (!vpaAddress || typeof vpaAddress !== "string") {
        return reply.status(400).send({ error: "vpaAddress is required" });
      }

      const resolved = await vpaCache.resolve(vpaAddress);
      if (!resolved) {
        return reply.status(404).send({ error: "VPA not found or inactive" });
      }

      logger.info({ vpa: vpaAddress }, "VPA resolved");
      return reply.send(resolved);
    },
  );
}
