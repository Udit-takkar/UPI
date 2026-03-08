import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  bigint,
  integer,
  boolean,
  timestamp,
  text,
  jsonb,
  index,
  unique,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ─────────────────────────────────────────────

export const txnStatusEnum = pgEnum("txn_status", [
  "RECEIVED",
  "VPA_RESOLVED",
  "DEBIT_INITIATED",
  "DEBIT_CONFIRMED",
  "DEBIT_FAILED",
  "CREDIT_INITIATED",
  "CREDIT_CONFIRMED",
  "CREDIT_FAILED",
  "REVERSAL_INITIATED",
  "REVERSED",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "DEEMED",
]);

export const orgTypeEnum = pgEnum("org_type", ["PSP", "BANK", "BOTH"]);

export const orgStatusEnum = pgEnum("org_status", [
  "PENDING",
  "SANDBOX",
  "ACTIVE",
  "SUSPENDED",
  "DEREGISTERED",
]);

export const vpaStatusEnum = pgEnum("vpa_status", [
  "ACTIVE",
  "INACTIVE",
  "BLOCKED",
]);

export const callbackStatusEnum = pgEnum("callback_status", [
  "PENDING",
  "DELIVERED",
  "FAILED",
]);

export const disputeStatusEnum = pgEnum("dispute_status", [
  "RAISED",
  "UNDER_REVIEW",
  "RESOLVED_DEBTOR",
  "RESOLVED_CREDITOR",
  "ESCALATED",
  "CLOSED",
]);

export const disputeTypeEnum = pgEnum("dispute_type", [
  "UNAUTHORIZED",
  "GOODS_NOT_RECEIVED",
  "DUPLICATE",
  "AMOUNT_MISMATCH",
  "OTHER",
]);

export const settlementStatusEnum = pgEnum("settlement_status", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

// ── Core Tables ───────────────────────────────────────

export const transactions = pgTable(
  "transactions",
  {
    txnId: uuid("txn_id").primaryKey(),
    rrn: varchar("rrn", { length: 12 }).notNull(),
    payerVpa: varchar("payer_vpa", { length: 255 }).notNull(),
    payeeVpa: varchar("payee_vpa", { length: 255 }).notNull(),
    payerIfsc: varchar("payer_ifsc", { length: 11 }),
    payeeIfsc: varchar("payee_ifsc", { length: 11 }),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    status: txnStatusEnum("status").notNull().default("RECEIVED"),
    orgTxnId: varchar("org_txn_id", { length: 255 }),
    pspOrgId: uuid("psp_org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("amount_positive", sql`${table.amountPaise} > 0`),
    unique("uq_psp_org_txn").on(table.pspOrgId, table.orgTxnId),
    index("idx_txn_rrn").on(table.rrn),
    index("idx_txn_payer_vpa").on(table.payerVpa, table.createdAt),
    index("idx_txn_payee_vpa").on(table.payeeVpa, table.createdAt),
    index("idx_txn_status")
      .on(table.status)
      .where(
        sql`status IN ('RECEIVED', 'VPA_RESOLVED', 'DEBIT_INITIATED', 'CREDIT_INITIATED')`,
      ),
    index("idx_txn_expires")
      .on(table.expiresAt)
      .where(sql`status IN ('RECEIVED', 'VPA_RESOLVED')`),
    index("idx_txn_psp_org").on(table.pspOrgId, table.createdAt),
  ],
);

export const txnAuditLog = pgTable(
  "txn_audit_log",
  {
    id: bigint("id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    txnId: uuid("txn_id").notNull(),
    fromState: txnStatusEnum("from_state"),
    toState: txnStatusEnum("to_state").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    prevHash: varchar("prev_hash", { length: 64 }),
    hash: varchar("hash", { length: 64 }).notNull(),
  },
  (table) => [index("idx_audit_txn_id").on(table.txnId, table.timestamp)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigint("id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    published: boolean("published").notNull().default(false),
  },
  (table) => [
    index("idx_outbox_unpublished")
      .on(table.createdAt)
      .where(sql`published = false`),
  ],
);

// ── Org & VPA Tables ──────────────────────────────────

export const registeredOrgs = pgTable(
  "registered_orgs",
  {
    orgId: uuid("org_id").primaryKey(),
    orgType: orgTypeEnum("org_type").notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    status: orgStatusEnum("status").notNull().default("PENDING"),
    publicKeyPem: text("public_key_pem"),
    mtlsCertFingerprint: varchar("mtls_cert_fingerprint", { length: 128 }),
    apiEndpoint: varchar("api_endpoint", { length: 512 }),
    drEndpoint: varchar("dr_endpoint", { length: 512 }),
    ipWhitelist: text("ip_whitelist").array(),
    maxTps: integer("max_tps").notNull().default(100),
    settlementAccountIfsc: varchar("settlement_account_ifsc", { length: 11 }),
    settlementAccountNumberEncrypted: text(
      "settlement_account_number_encrypted",
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_org_status").on(table.status)],
);

export const vpaHandles = pgTable("vpa_handles", {
  handle: varchar("handle", { length: 50 }).primaryKey(),
  owningOrgId: uuid("owning_org_id")
    .notNull()
    .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
  status: vpaStatusEnum("status").notNull().default("ACTIVE"),
  registeredAt: timestamp("registered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vpaMappings = pgTable(
  "vpa_mappings",
  {
    vpaAddress: varchar("vpa_address", { length: 255 }).primaryKey(),
    handle: varchar("handle", { length: 50 })
      .notNull()
      .references(() => vpaHandles.handle, { onDelete: "restrict" }),
    accountNumberEncrypted: text("account_number_encrypted").notNull(),
    ifsc: varchar("ifsc", { length: 11 }).notNull(),
    bankOrgId: uuid("bank_org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    pspOrgId: uuid("psp_org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    status: vpaStatusEnum("status").notNull().default("ACTIVE"),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deregisteredAt: timestamp("deregistered_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_vpa_handle").on(table.handle),
    index("idx_vpa_bank_org").on(table.bankOrgId),
    index("idx_vpa_psp_org").on(table.pspOrgId),
    index("idx_vpa_status")
      .on(table.status)
      .where(sql`status = 'ACTIVE'`),
  ],
);

// ── Supporting Tables ─────────────────────────────────

export const pendingCallbacks = pgTable(
  "pending_callbacks",
  {
    id: bigint("id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    txnId: uuid("txn_id").notNull(),
    callbackType: varchar("callback_type", { length: 50 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: callbackStatusEnum("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_callback_pending")
      .on(table.nextAttemptAt)
      .where(sql`status = 'PENDING'`),
    index("idx_callback_txn").on(table.txnId),
  ],
);

export const processedEvents = pgTable("processed_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const settlementBatches = pgTable("settlement_batches", {
  batchId: uuid("batch_id").primaryKey(),
  cycleStart: timestamp("cycle_start", { withTimezone: true }).notNull(),
  cycleEnd: timestamp("cycle_end", { withTimezone: true }).notNull(),
  status: settlementStatusEnum("status").notNull().default("PENDING"),
  totalDebitsPaise: bigint("total_debits_paise", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  totalCreditsPaise: bigint("total_credits_paise", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  fileChecksum: varchar("file_checksum", { length: 64 }),
  filePath: varchar("file_path", { length: 512 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const settlementEntries = pgTable(
  "settlement_entries",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => settlementBatches.batchId, { onDelete: "restrict" }),
    debtorOrgId: uuid("debtor_org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    creditorOrgId: uuid("creditor_org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    netAmountPaise: bigint("net_amount_paise", { mode: "bigint" }).notNull(),
    txnCount: integer("txn_count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.batchId, table.debtorOrgId, table.creditorOrgId],
    }),
  ],
);

export const disputes = pgTable(
  "disputes",
  {
    disputeId: uuid("dispute_id").primaryKey(),
    txnId: uuid("txn_id").notNull(),
    raisedByOrgId: uuid("raised_by_org_id")
      .notNull()
      .references(() => registeredOrgs.orgId, { onDelete: "restrict" }),
    disputeType: disputeTypeEnum("dispute_type").notNull(),
    status: disputeStatusEnum("status").notNull().default("RAISED"),
    evidencePath: varchar("evidence_path", { length: 512 }),
    autoVerdict: varchar("auto_verdict", { length: 50 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_dispute_txn").on(table.txnId),
    index("idx_dispute_status")
      .on(table.status)
      .where(sql`status IN ('RAISED', 'UNDER_REVIEW')`),
  ],
);
