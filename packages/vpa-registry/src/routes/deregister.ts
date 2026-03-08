import type { FastifyInstance } from "fastify";
import type { VpaRegistryDeps } from "../deps.js";
import type { VpaCache } from "../cache/vpa-cache.js";
import { schema } from "@repo/shared/db";
import { VpaDeregisterSchema } from "@repo/shared/schemas";
import { eq } from "drizzle-orm";
import type pino from "pino";

export function deregisterRoute(
  app: FastifyInstance,
  deps: VpaRegistryDeps,
  vpaCache: VpaCache,
  logger: pino.Logger,
) {
  app.post("/internal/vpa/deregister", async (request, reply) => {
    const parsed = VpaDeregisterSchema.parse(request.body);

    const existing = await deps.db.query.vpaMappings.findFirst({
      where: eq(schema.vpaMappings.vpaAddress, parsed.vpaAddress),
    });
    if (!existing || existing.status !== "ACTIVE") {
      return reply.status(404).send({ error: "VPA not found or already inactive" });
    }

    const handle = parsed.vpaAddress.split("@")[1]!;
    const vpaHandle = await deps.db.query.vpaHandles.findFirst({
      where: eq(schema.vpaHandles.handle, handle),
    });
    if (!vpaHandle || vpaHandle.owningOrgId !== parsed.header.orgId) {
      return reply.status(403).send({ error: "Handle not owned by requesting org" });
    }

    await deps.db
      .update(schema.vpaMappings)
      .set({
        status: "INACTIVE",
        deregisteredAt: new Date(),
      })
      .where(eq(schema.vpaMappings.vpaAddress, parsed.vpaAddress));

    vpaCache.invalidate(parsed.vpaAddress);
    logger.info({ vpa: parsed.vpaAddress }, "VPA deregistered");
    return reply.send({ vpaAddress: parsed.vpaAddress, status: "INACTIVE" });
  });
}
