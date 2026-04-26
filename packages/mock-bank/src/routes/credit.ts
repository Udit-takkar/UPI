import type { FastifyInstance } from "fastify";
import { getScenario } from "../scenarios.js";
import { recordTransaction } from "../ledger.js";

export function creditRoute(app: FastifyInstance) {
  app.post<{ Params: { bankSlug: string } }>(
    "/mock/:bankSlug/api/v1/credit",
    async (request, reply) => {
      const { bankSlug } = request.params;
      const body = request.body as {
        txnId: string;
        rrn: string;
        accountRef?: string;
        payeeAccountRef?: string;
        ifsc?: string;
        payeeIfsc?: string;
        amountPaise: string;
      };
      const scenario = getScenario(bankSlug, "credit");

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
        rrn: body.rrn,
        txnId: body.txnId,
        operation: "credit",
        amountPaise: body.amountPaise,
        ifsc: body.payeeIfsc ?? body.ifsc ?? "",
        accountRef: body.payeeAccountRef ?? body.accountRef ?? "",
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
