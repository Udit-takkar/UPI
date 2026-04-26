import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { debitRoute } from "./routes/debit.js";
import { creditRoute } from "./routes/credit.js";
import { reversalRoute } from "./routes/reversal.js";
import { statusRoute } from "./routes/status.js";
import { dumpRoute } from "./routes/dump.js";
import { controlRoute } from "./routes/control.js";

export async function createMockBankServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      transport: { target: "pino-pretty" },
    },
    requestTimeout: 120_000,
  });

  debitRoute(app);
  creditRoute(app);
  reversalRoute(app);
  statusRoute(app);
  dumpRoute(app);
  controlRoute(app);

  app.get("/health", async () => ({ status: "ok", service: "mock-bank" }));

  return app;
}
