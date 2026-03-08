import type { TxnStatus } from "../db/types.js";

export const VALID_TRANSITIONS: Record<TxnStatus, TxnStatus[]> = {
  RECEIVED: ["VPA_RESOLVED", "FAILED", "EXPIRED"],
  VPA_RESOLVED: ["DEBIT_INITIATED", "FAILED", "EXPIRED"],
  DEBIT_INITIATED: ["DEBIT_CONFIRMED", "DEBIT_FAILED"],
  DEBIT_CONFIRMED: ["CREDIT_INITIATED"],
  DEBIT_FAILED: ["FAILED"],
  CREDIT_INITIATED: ["CREDIT_CONFIRMED", "CREDIT_FAILED"],
  CREDIT_CONFIRMED: ["COMPLETED"],
  CREDIT_FAILED: ["REVERSAL_INITIATED", "DEEMED"],
  REVERSAL_INITIATED: ["REVERSED", "DEEMED"],
  REVERSED: [],
  COMPLETED: [],
  FAILED: [],
  EXPIRED: [],
  DEEMED: [],
};

export function canTransition(from: TxnStatus, to: TxnStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TxnStatus, to: TxnStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}
