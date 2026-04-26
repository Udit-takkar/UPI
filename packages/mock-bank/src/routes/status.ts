import type { FastifyInstance } from "fastify";
import { getScenario } from "../scenarios.js";
import { queryByRrn, queryByTxnId } from "../ledger.js";

export function statusRoute(app: FastifyInstance) {
  app.post<{ Params: { bankSlug: string } }>(
    "/mock/:bankSlug/api/v1/status",
    async (request, reply) => {
      const { bankSlug } = request.params;
      const body = request.body as { txnId: string; rrn: string };
      const scenario = getScenario(bankSlug, "status");

      await new Promise((r) => setTimeout(r, scenario.delayMs));

      if (scenario.behavior === "timeout") {
        await new Promise((r) => setTimeout(r, 60_000));
        return;
      }

      if (scenario.behavior === "error") {
        return reply.status(500).send({ error: "Internal server error" });
      }

      const entry = queryByRrn(body.rrn) ?? queryByTxnId(body.txnId);

      if (!entry) {
        return {
          txnId: body.txnId,
          rrn: body.rrn,
          found: false,
          operation: null,
          status: null,
          amountPaise: null,
          responseCode: "ZE",
        };
      }

      return {
        txnId: entry.txnId,
        rrn: entry.rrn,
        found: true,
        operation: entry.operation,
        status: entry.status,
        amountPaise: entry.amountPaise,
        responseCode: entry.responseCode,
      };
    },
  );
}
