import type { FastifyInstance } from "fastify";
import type { VpaRegistryDeps } from "../deps.js";
import type { VpaCache } from "../cache/vpa-cache.js";
import { schema } from "@repo/shared/db";
import { VpaRegisterSchema } from "@repo/shared/schemas";
import { eq } from "drizzle-orm";
import type pino from "pino";

export function registerRoute(
  app: FastifyInstance,
  deps: VpaRegistryDeps,
  vpaCache: VpaCache,
  logger: pino.Logger,
) {
  app.post("/internal/vpa/register", async (request, reply) => {
    const parsed = VpaRegisterSchema.parse(request.body);
    const handle = parsed.vpaAddress.split("@")[1]!;

    const vpaHandle = await deps.db.query.vpaHandles.findFirst({
      where: eq(schema.vpaHandles.handle, handle),
    });
    if (!vpaHandle || vpaHandle.owningOrgId !== parsed.header.orgId) {
      return reply.status(403).send({ error: "Handle not owned by requesting org" });
    }

    const existing = await deps.db.query.vpaMappings.findFirst({
      where: eq(schema.vpaMappings.vpaAddress, parsed.vpaAddress),
    });
    if (existing && existing.status === "ACTIVE") {
      return reply.status(409).send({ error: "VPA already registered" });
    }

    if (existing) {
      await deps.db
        .update(schema.vpaMappings)
        .set({
          accountNumberEncrypted: parsed.accountRef,
          ifsc: parsed.ifsc,
          bankOrgId: parsed.bankOrgId,
          pspOrgId: parsed.header.orgId,
          status: "ACTIVE",
          deregisteredAt: null,
          registeredAt: new Date(),
        })
        .where(eq(schema.vpaMappings.vpaAddress, parsed.vpaAddress));
    } else {
      await deps.db.insert(schema.vpaMappings).values({
        vpaAddress: parsed.vpaAddress,
        handle,
        accountNumberEncrypted: parsed.accountRef,
        ifsc: parsed.ifsc,
        bankOrgId: parsed.bankOrgId,
        pspOrgId: parsed.header.orgId,
        status: "ACTIVE",
      });
    }

    vpaCache.invalidate(parsed.vpaAddress);
    logger.info({ vpa: parsed.vpaAddress }, "VPA registered");
    return reply.status(201).send({ vpaAddress: parsed.vpaAddress, status: "ACTIVE" });
  });
}
