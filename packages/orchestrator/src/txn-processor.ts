import { eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import { assertTransition } from "@repo/shared/state-machine";
import { generateTxnId, generateRrn } from "@repo/shared/crypto";
import { TOPICS } from "@repo/shared/kafka";
import type { TxnStatus } from "@repo/shared/db/types";
import type { PayRequest } from "@repo/shared/schemas";
import { applyStateTransition, type TxnUpdates } from "./state-transition.js";
import { insertAuditEntry } from "./audit.js";
import { insertOutboxEvent, type OutboundEvent } from "./outbox.js";
import { isTerminalState, insertPendingCallback } from "./callback.js";
import type { OrchestratorDeps } from "./deps.js";
import type { VpaClient } from "./vpa-client.js";
import type pino from "pino";

const TXN_EXPIRY_MS = 5 * 60 * 1000;

export function createTxnProcessor(
  deps: OrchestratorDeps,
  vpaClient: VpaClient,
  logger: pino.Logger,
) {
  async function transitionState(
    txnId: string,
    fromState: TxnStatus,
    toState: TxnStatus,
    metadata: Record<string, unknown>,
    outbound?: OutboundEvent,
    txnUpdates?: TxnUpdates,
  ): Promise<void> {
    assertTransition(fromState, toState);

    await deps.db.transaction(async (tx) => {
      await applyStateTransition(tx, txnId, fromState, toState, txnUpdates);
      await insertAuditEntry(tx, txnId, fromState, toState, metadata);
      await insertOutboxEvent(tx, txnId, fromState, toState, metadata, outbound);

      if (isTerminalState(toState)) {
        const txn = await tx.query.transactions.findFirst({
          where: eq(schema.transactions.txnId, txnId),
        });
        if (txn) {
          await insertPendingCallback(tx, txn.pspOrgId, txnId, "TXN_STATUS", {
            txnId,
            orgTxnId: txn.orgTxnId,
            status: toState,
            responseCode: metadata.responseCode ?? null,
            amountPaise: txn.amountPaise.toString(),
            completedAt: new Date().toISOString(),
          });
        }
      }
    });

    logger.info({ txnId, fromState, toState }, "State transition");
  }

  async function handlePayRequest(
    payRequest: PayRequest,
    orgId: string,
  ): Promise<void> {
    const txnId = generateTxnId();
    const rrn = generateRrn();
    const expiresAt = payRequest.expiresAt
      ? new Date(payRequest.expiresAt)
      : new Date(Date.now() + TXN_EXPIRY_MS);

    await deps.db.transaction(async (tx) => {
      await tx.insert(schema.transactions).values({
        txnId,
        rrn,
        payerVpa: payRequest.payerVpa,
        payeeVpa: payRequest.payeeVpa,
        amountPaise: payRequest.amountPaise,
        currency: payRequest.currency ?? "INR",
        status: "RECEIVED",
        orgTxnId: payRequest.orgTxnId ?? null,
        pspOrgId: orgId,
        version: 1,
        expiresAt,
      });

      await insertAuditEntry(tx, txnId, null, "RECEIVED", { orgId, rrn });
    });

    logger.info({ txnId, rrn, payer: payRequest.payerVpa, payee: payRequest.payeeVpa }, "Transaction created");

    await resolveAndAdvance(txnId, rrn, payRequest);
  }

  async function resolveAndAdvance(
    txnId: string,
    rrn: string,
    payRequest: PayRequest,
  ): Promise<void> {
    const payerVpa = await vpaClient.resolve(payRequest.payerVpa);
    if (!payerVpa) {
      await transitionState(txnId, "RECEIVED", "FAILED", { reason: "Payer VPA not found" });
      return;
    }

    const payeeVpa = await vpaClient.resolve(payRequest.payeeVpa);
    if (!payeeVpa) {
      await transitionState(txnId, "RECEIVED", "FAILED", { reason: "Payee VPA not found" });
      return;
    }

    await transitionState(
      txnId, "RECEIVED", "VPA_RESOLVED",
      { payerBank: payerVpa.bankOrgId, payeeBank: payeeVpa.bankOrgId },
      undefined,
      { payerIfsc: payerVpa.ifsc, payeeIfsc: payeeVpa.ifsc },
    );

    await transitionState(
      txnId, "VPA_RESOLVED", "DEBIT_INITIATED",
      { bankOrgId: payerVpa.bankOrgId },
      {
        topic: TOPICS.DEBIT_REQUEST,
        payload: {
          txnId,
          rrn,
          payerVpa: payRequest.payerVpa,
          payerIfsc: payerVpa.ifsc,
          payerAccountRef: payerVpa.accountNumberEncrypted,
          payerBankOrgId: payerVpa.bankOrgId,
          payeeVpa: payRequest.payeeVpa,
          payeeIfsc: payeeVpa.ifsc,
          payeeBankOrgId: payeeVpa.bankOrgId,
          payeeAccountRef: payeeVpa.accountNumberEncrypted,
          amountPaise: payRequest.amountPaise.toString(),
          currency: payRequest.currency ?? "INR",
          note: payRequest.note,
        },
      },
    );

    logger.info({ txnId }, "Debit request written to outbox");
  }

  async function handleDebitResponse(message: {
    txnId: string;
    rrn: string;
    success: boolean;
    responseCode: string;
    payeeVpa: string;
    payeeIfsc: string;
    payeeBankOrgId: string;
    payeeAccountRef: string;
    amountPaise: string;
    currency: string;
  }): Promise<void> {
    if (!message.success) {
      await transitionState(message.txnId, "DEBIT_INITIATED", "DEBIT_FAILED", {
        responseCode: message.responseCode,
      });
      await transitionState(message.txnId, "DEBIT_FAILED", "FAILED", {
        responseCode: message.responseCode,
      });
      return;
    }

    await transitionState(message.txnId, "DEBIT_INITIATED", "DEBIT_CONFIRMED", {
      responseCode: message.responseCode,
    });

    await transitionState(
      message.txnId, "DEBIT_CONFIRMED", "CREDIT_INITIATED",
      { bankOrgId: message.payeeBankOrgId },
      {
        topic: TOPICS.CREDIT_REQUEST,
        payload: {
          txnId: message.txnId,
          rrn: message.rrn,
          payeeVpa: message.payeeVpa,
          payeeIfsc: message.payeeIfsc,
          payeeBankOrgId: message.payeeBankOrgId,
          payeeAccountRef: message.payeeAccountRef,
          amountPaise: message.amountPaise,
          currency: message.currency,
        },
      },
    );

    logger.info({ txnId: message.txnId }, "Credit request written to outbox");
  }

  async function handleCreditResponse(message: {
    txnId: string;
    success: boolean;
    responseCode: string;
  }): Promise<void> {
    if (!message.success) {
      await transitionState(message.txnId, "CREDIT_INITIATED", "CREDIT_FAILED", {
        responseCode: message.responseCode,
      });

      const txn = await deps.db.query.transactions.findFirst({
        where: eq(schema.transactions.txnId, message.txnId),
      });

      const payerVpaData = txn ? await vpaClient.resolve(txn.payerVpa) : null;

      await transitionState(
        message.txnId, "CREDIT_FAILED", "REVERSAL_INITIATED",
        { reason: "Credit failed, initiating reversal" },
        {
          topic: TOPICS.REVERSAL_REQUEST,
          payload: {
            txnId: message.txnId,
            originalRrn: txn?.rrn ?? "",
            reason: `Credit failed: ${message.responseCode}`,
            payerBankOrgId: payerVpaData?.bankOrgId ?? "",
            payerAccountRef: payerVpaData?.accountNumberEncrypted ?? "",
            payerIfsc: txn?.payerIfsc ?? "",
            amountPaise: txn?.amountPaise?.toString() ?? "0",
            currency: txn?.currency ?? "INR",
          },
        },
      );
      return;
    }

    await transitionState(message.txnId, "CREDIT_INITIATED", "CREDIT_CONFIRMED", {
      responseCode: message.responseCode,
    });
    await transitionState(message.txnId, "CREDIT_CONFIRMED", "COMPLETED", {
      responseCode: message.responseCode,
    });

    logger.info({ txnId: message.txnId }, "Transaction completed");
  }

  async function handleReversalResponse(message: {
    txnId: string;
    success: boolean;
    responseCode: string;
  }): Promise<void> {
    if (message.success) {
      await transitionState(message.txnId, "REVERSAL_INITIATED", "REVERSED", {
        responseCode: message.responseCode,
      });
      logger.info({ txnId: message.txnId }, "Transaction reversed");
    } else {
      await transitionState(message.txnId, "REVERSAL_INITIATED", "DEEMED", {
        responseCode: message.responseCode,
        reason: "Reversal failed, marked as deemed",
      });
      logger.warn({ txnId: message.txnId }, "Reversal failed, transaction deemed");
    }
  }

  return {
    handlePayRequest,
    handleDebitResponse,
    handleCreditResponse,
    handleReversalResponse,
    transitionState,
  };
}

export type TxnProcessor = ReturnType<typeof createTxnProcessor>;
