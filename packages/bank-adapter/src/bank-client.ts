import type pino from "pino";
import { BankApiResponseSchema, type BankApiResponse } from "./kafka-schemas.js";
import { BankCallError } from "./resilience.js";

interface DebitCreditRequest {
  txnId: string;
  rrn: string;
  accountRef: string;
  ifsc: string;
  amountPaise: string;
  currency: string;
}

interface ReversalApiRequest {
  txnId: string;
  originalRrn: string;
  reason: string;
}

async function callBank(
  url: string,
  body: unknown,
  signal: AbortSignal,
  logger: pino.Logger,
): Promise<BankApiResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ url, status: res.status, body: text }, "Bank API error");
    throw new BankCallError(`Bank API returned ${res.status}`, res.status);
  }

  return BankApiResponseSchema.parse(await res.json());
}

export function createBankClient(logger: pino.Logger) {
  return {
    async debit(
      baseUrl: string,
      request: DebitCreditRequest,
      signal: AbortSignal,
    ): Promise<BankApiResponse> {
      return callBank(`${baseUrl}/api/v1/debit`, request, signal, logger);
    },

    async credit(
      baseUrl: string,
      request: DebitCreditRequest,
      signal: AbortSignal,
    ): Promise<BankApiResponse> {
      return callBank(`${baseUrl}/api/v1/credit`, request, signal, logger);
    },

    async reversal(
      baseUrl: string,
      request: ReversalApiRequest,
      signal: AbortSignal,
    ): Promise<BankApiResponse> {
      return callBank(`${baseUrl}/api/v1/reversal`, request, signal, logger);
    },
  };
}

export type BankClient = ReturnType<typeof createBankClient>;
