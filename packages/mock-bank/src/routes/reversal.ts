import type { FastifyInstance } from "fastify";
import { getScenario } from "../scenarios.js";
import { recordTransaction } from "../ledger.js";

export function reversalRoute(app: FastifyInstance) {
  app.post<{ Params: { bankSlug: string } }>(
    "/mock/:bankSlug/api/v1/reversal",
    async (request, reply) => {
      const { bankSlug } = request.params;
      const body = request.body as {
        txnId: string;
        originalRrn: string;
        amountPaise?: string;
        payerIfsc?: string;
        payerAccountRef?: string;
      };
      const scenario = getScenario(bankSlug, "reversal");

      await new Promise((r) => setTimeout(r, scenario.delayMs));

      if (scenario.behavior === "timeout") {
        await new Promise((r) => setTimeout(r, 60_000));
        return;
      }

      if (scenario.behavior === "error") {
        return reply.status(500).send({ error: "Internal server error" });
      }

      const success = scenario.behavior === "success";

      recordTransaction({
        rrn: body.originalRrn,
        txnId: body.txnId,
        operation: "reversal",
        amountPaise: body.amountPaise ?? "0",
        ifsc: body.payerIfsc ?? "",
        accountRef: body.payerAccountRef ?? "",
        status: success ? "SUCCESS" : "FAILED",
        responseCode: scenario.responseCode,
        timestamp: new Date(),
      });

      return {
        txnId: body.txnId,
        success,
        responseCode: scenario.responseCode,
      };
    },
  );
}
