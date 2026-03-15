export const TOPICS = {
  PAY_REQUEST: "txn.pay.request",
  COLLECT_REQUEST: "txn.collect.request",
  DEBIT_REQUEST: "txn.debit.request",
  DEBIT_RESPONSE: "txn.debit.response",
  CREDIT_REQUEST: "txn.credit.request",
  CREDIT_RESPONSE: "txn.credit.response",
  REVERSAL_REQUEST: "txn.reversal.request",
  REVERSAL_RESPONSE: "txn.reversal.response",
  STATUS_QUERY: "txn.status.query",
  CALLBACK: "txn.callback",
  DLQ: "txn.dlq",
  OUTBOX: "outbox.events",
  AUDIT_LOG: "audit.log",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];
