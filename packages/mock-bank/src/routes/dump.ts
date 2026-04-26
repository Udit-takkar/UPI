import type { FastifyInstance } from "fastify";
import { getTransactionsInRange } from "../ledger.js";

export function dumpRoute(app: FastifyInstance) {
  app.get<{
    Params: { bankSlug: string };
    Querystring: { start: string; end: string };
  }>(
    "/mock/:bankSlug/api/v1/dump",
    async (request) => {
      const { bankSlug } = request.params;
      const start = new Date(request.query.start);
      const end = new Date(request.query.end);

      const transactions = getTransactionsInRange(start, end);

      return {
        bankSlug,
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        transactions: transactions.map((t) => ({
          rrn: t.rrn,
          txnId: t.txnId,
          operation: t.operation,
          amountPaise: t.amountPaise,
          status: t.status,
          timestamp: t.timestamp.toISOString(),
        })),
        count: transactions.length,
      };
    },
  );
}
