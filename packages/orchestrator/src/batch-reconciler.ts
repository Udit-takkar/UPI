import { and, gte, lt, inArray, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type { TxnStatus } from "@repo/shared/db/types";
import type { OrgResolver } from "./org-resolver.js";
import type pino from "pino";

const TERMINAL_STATES: TxnStatus[] = ["COMPLETED", "FAILED", "REVERSED", "DEEMED", "EXPIRED"];

interface BankDumpTransaction {
  rrn: string;
  txnId: string;
  operation: string;
  amountPaise: string;
  status: string;
  timestamp: string;
}

interface BankDumpResponse {
  bankSlug: string;
  transactions: BankDumpTransaction[];
  count: number;
}

export async function runBatchReconciliation(
  db: Database,
  orgResolver: OrgResolver,
  cycleStart: Date,
  cycleEnd: Date,
  logger: pino.Logger,
): Promise<void> {
  const batchId = randomUUID();
  logger.info({ batchId, cycleStart, cycleEnd }, "Starting batch reconciliation");

  const switchTxns = await db
    .select({
      txnId: schema.transactions.txnId,
      rrn: schema.transactions.rrn,
      payerVpa: schema.transactions.payerVpa,
      payeeVpa: schema.transactions.payeeVpa,
      amountPaise: schema.transactions.amountPaise,
      status: schema.transactions.status,
    })
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.status, TERMINAL_STATES),
        gte(schema.transactions.updatedAt, cycleStart),
        lt(schema.transactions.updatedAt, cycleEnd),
      ),
    );

  const bankOrgIds = new Set<string>();
  for (const txn of switchTxns) {
    const payerMapping = await db.query.vpaMappings.findFirst({
      where: eq(schema.vpaMappings.vpaAddress, txn.payerVpa),
    });
    const payeeMapping = await db.query.vpaMappings.findFirst({
      where: eq(schema.vpaMappings.vpaAddress, txn.payeeVpa),
    });
    if (payerMapping) bankOrgIds.add(payerMapping.bankOrgId);
    if (payeeMapping) bankOrgIds.add(payeeMapping.bankOrgId);
  }

  const switchByRrn = new Map(switchTxns.map((t) => [t.rrn, t]));

  for (const bankOrgId of bankOrgIds) {
    try {
      const org = await orgResolver.resolve(bankOrgId);
      if (!org.apiEndpoint) {
        logger.warn({ bankOrgId }, "No apiEndpoint for bank, skipping recon");
        continue;
      }

      const dumpUrl = `${org.apiEndpoint}/api/v1/dump?start=${cycleStart.toISOString()}&end=${cycleEnd.toISOString()}`;
      const response = await fetch(dumpUrl);
      if (!response.ok) {
        logger.error({ bankOrgId, status: response.status }, "Failed to fetch bank dump");
        continue;
      }

      const dump = (await response.json()) as BankDumpResponse;
      const bankByRrn = new Map(dump.transactions.map((t) => [t.rrn, t]));

      let matchedCount = 0;
      let mismatchCount = 0;
      const mismatches: Array<{
        rrn: string;
        mismatchType: "PHANTOM" | "MISSED" | "AMOUNT_MISMATCH" | "STATUS_MISMATCH";
        switchAmountPaise: bigint | null;
        bankAmountPaise: bigint | null;
        switchStatus: TxnStatus | null;
        bankStatus: string | null;
      }> = [];

      for (const [rrn, bankTxn] of bankByRrn) {
        const switchTxn = switchByRrn.get(rrn);
        if (!switchTxn) {
          mismatches.push({
            rrn,
            mismatchType: "PHANTOM",
            switchAmountPaise: null,
            bankAmountPaise: BigInt(bankTxn.amountPaise),
            switchStatus: null,
            bankStatus: bankTxn.status,
          });
          mismatchCount++;
          continue;
        }

        if (switchTxn.amountPaise.toString() !== bankTxn.amountPaise) {
          mismatches.push({
            rrn,
            mismatchType: "AMOUNT_MISMATCH",
            switchAmountPaise: switchTxn.amountPaise,
            bankAmountPaise: BigInt(bankTxn.amountPaise),
            switchStatus: switchTxn.status,
            bankStatus: bankTxn.status,
          });
          mismatchCount++;
          continue;
        }

        matchedCount++;
      }

      for (const [rrn, switchTxn] of switchByRrn) {
        if (!bankByRrn.has(rrn)) {
          mismatches.push({
            rrn,
            mismatchType: "MISSED",
            switchAmountPaise: switchTxn.amountPaise,
            bankAmountPaise: null,
            switchStatus: switchTxn.status,
            bankStatus: null,
          });
          mismatchCount++;
        }
      }

      await db.transaction(async (tx) => {
        const [report] = await tx.insert(schema.reconReports).values({
          batchId,
          bankOrgId,
          cycleStart,
          cycleEnd,
          totalSwitchTxns: switchTxns.length,
          totalBankTxns: dump.count,
          matchedCount,
          mismatchCount,
        }).returning({ id: schema.reconReports.id });

        if (mismatches.length > 0 && report) {
          for (const m of mismatches) {
            await tx.insert(schema.reconMismatches).values({
              reportId: report.id,
              rrn: m.rrn,
              mismatchType: m.mismatchType,
              switchAmountPaise: m.switchAmountPaise,
              bankAmountPaise: m.bankAmountPaise,
              switchStatus: m.switchStatus,
              bankStatus: m.bankStatus,
            });
          }
        }
      });

      logger.info(
        { bankOrgId, matched: matchedCount, mismatches: mismatchCount, bankTxns: dump.count },
        "Bank reconciliation complete",
      );
    } catch (err) {
      logger.error({ bankOrgId, err }, "Failed to reconcile with bank");
    }
  }

  logger.info({ batchId }, "Batch reconciliation complete");
}
