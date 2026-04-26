import { sendMessage } from "@repo/shared/kafka";
import { TOPICS } from "@repo/shared/kafka";
import type pino from "pino";
import type { BankAdapterDeps } from "./deps.js";
import type { ResilienceLayer } from "./resilience.js";
import { CircuitOpenError } from "./circuit-breaker.js";
import { BulkheadFullError } from "./bulkhead.js";
import type { BankClient } from "./bank-client.js";
import type { OrgResolver } from "./org-resolver.js";
import type { DebitRequest, CreditRequest, ReversalRequest, ReconStatusRequest } from "./kafka-schemas.js";

const RESPONSE_CODES = {
  BANK_UNAVAILABLE: "ZS",
  TIMEOUT: "U30",
  INTERNAL_ERROR: "U28",
} as const;

function mapErrorToResponseCode(err: unknown): string {
  if (err instanceof CircuitOpenError) return RESPONSE_CODES.BANK_UNAVAILABLE;
  if (err instanceof BulkheadFullError) return RESPONSE_CODES.BANK_UNAVAILABLE;
  if (err instanceof DOMException && err.name === "AbortError") return RESPONSE_CODES.TIMEOUT;
  return RESPONSE_CODES.INTERNAL_ERROR;
}

export function createBankPool(
  deps: BankAdapterDeps,
  resilienceLayer: ResilienceLayer,
  bankClient: BankClient,
  orgResolver: OrgResolver,
  logger: pino.Logger,
) {
  async function sendDebit(message: DebitRequest): Promise<void> {
    const org = await orgResolver.resolve(message.payerBankOrgId);

    if (!org.apiEndpoint) {
      throw new Error(`No apiEndpoint for bank ${message.payerBankOrgId}`);
    }

    try {
      const bankResponse = await resilienceLayer.execute(
        message.payerBankOrgId,
        (signal) =>
          bankClient.debit(org.apiEndpoint!, {
            txnId: message.txnId,
            rrn: message.rrn,
            accountRef: message.payerAccountRef,
            ifsc: message.payerIfsc,
            amountPaise: message.amountPaise,
            currency: message.currency,
          }, signal),
      );

      await sendMessage(deps.kafkaProducer, TOPICS.DEBIT_RESPONSE, message.txnId, {
        txnId: message.txnId,
        rrn: message.rrn,
        success: bankResponse.success,
        responseCode: bankResponse.responseCode,
        payeeVpa: message.payeeVpa,
        payeeIfsc: message.payeeIfsc,
        payeeBankOrgId: message.payeeBankOrgId,
        payeeAccountRef: message.payeeAccountRef ?? "",
        amountPaise: message.amountPaise,
        currency: message.currency,
      });

      logger.info({ txnId: message.txnId, success: bankResponse.success }, "Debit response published");
    } catch (err) {
      const responseCode = mapErrorToResponseCode(err);
      logger.error({ txnId: message.txnId, err, responseCode }, "Debit call failed");

      await sendMessage(deps.kafkaProducer, TOPICS.DEBIT_RESPONSE, message.txnId, {
        txnId: message.txnId,
        rrn: message.rrn,
        success: false,
        responseCode,
        payeeVpa: message.payeeVpa,
        payeeIfsc: message.payeeIfsc,
        payeeBankOrgId: message.payeeBankOrgId,
        payeeAccountRef: message.payeeAccountRef ?? "",
        amountPaise: message.amountPaise,
        currency: message.currency,
      });
    }
  }

  async function sendCredit(message: CreditRequest): Promise<void> {
    const org = await orgResolver.resolve(message.payeeBankOrgId);

    if (!org.apiEndpoint) {
      throw new Error(`No apiEndpoint for bank ${message.payeeBankOrgId}`);
    }

    try {
      const bankResponse = await resilienceLayer.execute(
        message.payeeBankOrgId,
        (signal) =>
          bankClient.credit(org.apiEndpoint!, {
            txnId: message.txnId,
            rrn: message.rrn,
            accountRef: message.payeeAccountRef,
            ifsc: message.payeeIfsc,
            amountPaise: message.amountPaise,
            currency: message.currency,
          }, signal),
      );

      await sendMessage(deps.kafkaProducer, TOPICS.CREDIT_RESPONSE, message.txnId, {
        txnId: message.txnId,
        success: bankResponse.success,
        responseCode: bankResponse.responseCode,
      });

      logger.info({ txnId: message.txnId, success: bankResponse.success }, "Credit response published");
    } catch (err) {
      const responseCode = mapErrorToResponseCode(err);
      logger.error({ txnId: message.txnId, err, responseCode }, "Credit call failed");

      await sendMessage(deps.kafkaProducer, TOPICS.CREDIT_RESPONSE, message.txnId, {
        txnId: message.txnId,
        success: false,
        responseCode,
      });
    }
  }

  async function sendReversal(message: ReversalRequest): Promise<void> {
    const org = await orgResolver.resolve(message.payerBankOrgId);

    if (!org.apiEndpoint) {
      throw new Error(`No apiEndpoint for bank ${message.payerBankOrgId}`);
    }

    try {
      const bankResponse = await resilienceLayer.execute(
        message.payerBankOrgId,
        (signal) =>
          bankClient.reversal(org.apiEndpoint!, {
            txnId: message.txnId,
            originalRrn: message.originalRrn,
            reason: message.reason,
          }, signal),
      );

      await sendMessage(deps.kafkaProducer, TOPICS.REVERSAL_RESPONSE, message.txnId, {
        txnId: message.txnId,
        success: bankResponse.success,
        responseCode: bankResponse.responseCode,
      });

      logger.info({ txnId: message.txnId, success: bankResponse.success }, "Reversal response published");
    } catch (err) {
      const responseCode = mapErrorToResponseCode(err);
      logger.error({ txnId: message.txnId, err, responseCode }, "Reversal call failed");

      await sendMessage(deps.kafkaProducer, TOPICS.REVERSAL_RESPONSE, message.txnId, {
        txnId: message.txnId,
        success: false,
        responseCode,
      });
    }
  }

  async function sendStatusQuery(message: ReconStatusRequest): Promise<void> {
    const org = await orgResolver.resolve(message.bankOrgId);

    if (!org.apiEndpoint) {
      throw new Error(`No apiEndpoint for bank ${message.bankOrgId}`);
    }

    try {
      const bankResponse = await resilienceLayer.execute(
        message.bankOrgId,
        (signal) =>
          bankClient.statusQuery(org.apiEndpoint!, {
            txnId: message.txnId,
            rrn: message.rrn,
          }, signal),
      );

      await sendMessage(deps.kafkaProducer, TOPICS.RECON_STATUS_RESPONSE, message.txnId, {
        txnId: message.txnId,
        rrn: message.rrn,
        found: bankResponse.found,
        operation: bankResponse.operation,
        bankStatus: bankResponse.status,
        amountPaise: bankResponse.amountPaise,
        responseCode: bankResponse.responseCode,
      });

      logger.info({ txnId: message.txnId, found: bankResponse.found }, "Recon status response published");
    } catch (err) {
      const responseCode = mapErrorToResponseCode(err);
      logger.error({ txnId: message.txnId, err, responseCode }, "Recon status query failed");

      await sendMessage(deps.kafkaProducer, TOPICS.RECON_STATUS_RESPONSE, message.txnId, {
        txnId: message.txnId,
        rrn: message.rrn,
        found: false,
        operation: null,
        bankStatus: null,
        amountPaise: null,
        responseCode,
      });
    }
  }

  return { sendDebit, sendCredit, sendReversal, sendStatusQuery };
}

export type BankPool = ReturnType<typeof createBankPool>;
