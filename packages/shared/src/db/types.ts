import type {
  transactions,
  txnAuditLog,
  outboxEvents,
  registeredOrgs,
  vpaHandles,
  vpaMappings,
  pendingCallbacks,
  processedEvents,
  settlementBatches,
  settlementEntries,
  disputes,
} from './schema.js';

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type TxnAuditEntry = typeof txnAuditLog.$inferSelect;
export type NewTxnAuditEntry = typeof txnAuditLog.$inferInsert;

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

export type RegisteredOrg = typeof registeredOrgs.$inferSelect;
export type NewRegisteredOrg = typeof registeredOrgs.$inferInsert;

export type VpaHandle = typeof vpaHandles.$inferSelect;
export type NewVpaHandle = typeof vpaHandles.$inferInsert;

export type VpaMapping = typeof vpaMappings.$inferSelect;
export type NewVpaMapping = typeof vpaMappings.$inferInsert;

export type PendingCallback = typeof pendingCallbacks.$inferSelect;
export type NewPendingCallback = typeof pendingCallbacks.$inferInsert;

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type NewProcessedEvent = typeof processedEvents.$inferInsert;

export type SettlementBatch = typeof settlementBatches.$inferSelect;
export type NewSettlementBatch = typeof settlementBatches.$inferInsert;

export type SettlementEntry = typeof settlementEntries.$inferSelect;
export type NewSettlementEntry = typeof settlementEntries.$inferInsert;

export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;

export type TxnStatus = Transaction['status'];
export type OrgType = RegisteredOrg['orgType'];
export type OrgStatus = RegisteredOrg['status'];
export type VpaStatus = VpaMapping['status'];
export type CallbackStatus = PendingCallback['status'];
export type DisputeType = Dispute['disputeType'];
export type DisputeStatus = Dispute['status'];
export type SettlementStatus = SettlementBatch['status'];
