import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { setScenario, clearScenarios } from "../scenarios.js";

const SetScenarioSchema = z.object({
  bankSlug: z.string(),
  operation: z.enum(["debit", "credit", "reversal"]),
  behavior: z.enum(["success", "failure", "timeout", "error"]),
  responseCode: z.string().optional(),
  delayMs: z.number().int().min(0).optional(),
});

export function controlRoute(app: FastifyInstance) {
  app.post("/admin/scenario", async (request) => {
    const body = SetScenarioSchema.parse(request.body);

    setScenario(body.bankSlug, body.operation, {
      behavior: body.behavior,
      ...(body.responseCode ? { responseCode: body.responseCode } : {}),
      ...(body.delayMs !== undefined ? { delayMs: body.delayMs } : {}),
    });

    return { status: "ok", bankSlug: body.bankSlug, operation: body.operation, behavior: body.behavior };
  });

  app.delete("/admin/scenarios", async () => {
    clearScenarios();
    return { status: "ok", message: "All scenarios cleared" };
  });
}
