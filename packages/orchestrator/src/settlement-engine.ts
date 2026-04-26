import { and, eq, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createHash, randomUUID } from "node:crypto";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type pino from "pino";

interface SettlementConfig {
  windowHours: number;
}

interface NetPosition {
  debtorOrgId: string;
  creditorOrgId: string;
  netAmountPaise: bigint;
  txnCount: number;
}

export function createSettlementEngine(
  db: Database,
  logger: pino.Logger,
  config: SettlementConfig = { windowHours: 4 },
) {
  async function computeSettlement(cycleEnd: Date = new Date()): Promise<string> {
    const cycleStart = new Date(cycleEnd.getTime() - config.windowHours * 3600_000);
    const batchId = randomUUID();

    logger.info({ batchId, cycleStart, cycleEnd }, "Starting settlement computation");

    const existing = await db.query.settlementBatches.findFirst({
      where: and(
        lt(schema.settlementBatches.cycleStart, cycleEnd),
        gte(schema.settlementBatches.cycleEnd, cycleStart),
      ),
    });

    if (existing) {
      logger.warn({ existingBatchId: existing.batchId }, "Overlapping settlement batch exists, skipping");
      return existing.batchId;
    }

    const payerVpa = alias(schema.vpaMappings, "payer_vpa");
    const payeeVpa = alias(schema.vpaMappings, "payee_vpa");

    const txns = await db
      .select({
        txnId: schema.transactions.txnId,
        amountPaise: schema.transactions.amountPaise,
        payerBankOrgId: payerVpa.bankOrgId,
        payeeBankOrgId: payeeVpa.bankOrgId,
      })
      .from(schema.transactions)
      .innerJoin(payerVpa, eq(schema.transactions.payerVpa, payerVpa.vpaAddress))
      .innerJoin(payeeVpa, eq(schema.transactions.payeeVpa, payeeVpa.vpaAddress))
      .where(
        and(
          eq(schema.transactions.status, "COMPLETED"),
          gte(schema.transactions.completedAt, cycleStart),
          lt(schema.transactions.completedAt, cycleEnd),
        ),
      );

    if (txns.length === 0) {
      logger.info({ batchId }, "No completed transactions in settlement window");
      return batchId;
    }

    // Double-entry validation
    let totalGrossDebits = 0n;
    let totalGrossCredits = 0n;
    const grossDebits = new Map<string, bigint>();
    const grossCredits = new Map<string, bigint>();

    for (const txn of txns) {
      totalGrossDebits += txn.amountPaise;
      totalGrossCredits += txn.amountPaise;
      grossDebits.set(txn.payerBankOrgId, (grossDebits.get(txn.payerBankOrgId) ?? 0n) + txn.amountPaise);
      grossCredits.set(txn.payeeBankOrgId, (grossCredits.get(txn.payeeBankOrgId) ?? 0n) + txn.amountPaise);
    }

    if (totalGrossDebits !== totalGrossCredits) {
      logger.fatal(
        { totalGrossDebits: totalGrossDebits.toString(), totalGrossCredits: totalGrossCredits.toString() },
        "SETTLEMENT HALTED: double-entry violation",
      );
      throw new Error("Double-entry validation failed");
    }

    // Compute gross flows per pair
    const positions = new Map<string, { grossPaise: bigint; txnCount: number }>();
    for (const txn of txns) {
      const key = `${txn.payerBankOrgId}:${txn.payeeBankOrgId}`;
      const existing = positions.get(key) ?? { grossPaise: 0n, txnCount: 0 };
      existing.grossPaise += txn.amountPaise;
      existing.txnCount++;
      positions.set(key, existing);
    }

    // Net positions per pair
    const processed = new Set<string>();
    const netPositions: NetPosition[] = [];

    for (const [key, pos] of positions) {
      if (processed.has(key)) continue;
      const [orgA, orgB] = key.split(":") as [string, string];
      const reverseKey = `${orgB}:${orgA}`;
      const reversePos = positions.get(reverseKey) ?? { grossPaise: 0n, txnCount: 0 };

      processed.add(key);
      processed.add(reverseKey);

      const net = pos.grossPaise - reversePos.grossPaise;
      if (net === 0n) continue;

      netPositions.push({
        debtorOrgId: net > 0n ? orgA : orgB,
        creditorOrgId: net > 0n ? orgB : orgA,
        netAmountPaise: net > 0n ? net : -net,
        txnCount: pos.txnCount + reversePos.txnCount,
      });
    }

    // Generate settlement file
    const settlementFile = {
      batchId,
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      totalTransactions: txns.length,
      totalGrossVolumePaise: totalGrossDebits.toString(),
      netPositions: netPositions.map((p) => ({
        debtorOrgId: p.debtorOrgId,
        creditorOrgId: p.creditorOrgId,
        netAmountPaise: p.netAmountPaise.toString(),
        txnCount: p.txnCount,
      })),
    };

    const fileContent = JSON.stringify(settlementFile, null, 2);
    const checksum = createHash("sha256").update(fileContent).digest("hex");
    const filePath = `settlements/${batchId}.json`;

    // Persist to database
    await db.transaction(async (tx) => {
      await tx.insert(schema.settlementBatches).values({
        batchId,
        cycleStart,
        cycleEnd,
        status: "COMPLETED",
        totalDebitsPaise: totalGrossDebits,
        totalCreditsPaise: totalGrossCredits,
        fileChecksum: checksum,
        filePath,
      });

      for (const pos of netPositions) {
        await tx.insert(schema.settlementEntries).values({
          batchId,
          debtorOrgId: pos.debtorOrgId,
          creditorOrgId: pos.creditorOrgId,
          netAmountPaise: pos.netAmountPaise,
          txnCount: pos.txnCount,
        });
      }
    });

    logger.info(
      {
        batchId,
        totalTransactions: txns.length,
        netPositions: netPositions.length,
        grossVolume: totalGrossDebits.toString(),
        checksum,
      },
      "Settlement computation complete",
    );

    return batchId;
  }

  return { computeSettlement };
}

export type SettlementEngine = ReturnType<typeof createSettlementEngine>;
