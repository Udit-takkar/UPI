import type { FastifyInstance } from "fastify";
import { getScenario } from "../scenarios.js";

export function debitRoute(app: FastifyInstance) {
  app.post<{ Params: { bankSlug: string } }>(
    "/mock/:bankSlug/api/v1/debit",
    async (request, reply) => {
      const { bankSlug } = request.params;
      const body = request.body as { txnId: string };
      const scenario = getScenario(bankSlug, "debit");

      await new Promise((r) => setTimeout(r, scenario.delayMs));

      if (scenario.behavior === "timeout") {
        await new Promise((r) => setTimeout(r, 60_000));
        return;
      }

      if (scenario.behavior === "error") {
        return reply.status(500).send({ error: "Internal server error" });
      }

      return {
        txnId: body.txnId,
        success: scenario.behavior === "success",
        responseCode: scenario.responseCode,
      };
    },
  );
}
