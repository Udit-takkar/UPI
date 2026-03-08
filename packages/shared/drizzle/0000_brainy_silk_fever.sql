CREATE TYPE "public"."callback_status" AS ENUM('PENDING', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('RAISED', 'UNDER_REVIEW', 'RESOLVED_DEBTOR', 'RESOLVED_CREDITOR', 'ESCALATED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('UNAUTHORIZED', 'GOODS_NOT_RECEIVED', 'DUPLICATE', 'AMOUNT_MISMATCH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('PENDING', 'SANDBOX', 'ACTIVE', 'SUSPENDED', 'DEREGISTERED');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('PSP', 'BANK', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('RECEIVED', 'VPA_RESOLVED', 'DEBIT_INITIATED', 'DEBIT_CONFIRMED', 'DEBIT_FAILED', 'CREDIT_INITIATED', 'CREDIT_CONFIRMED', 'CREDIT_FAILED', 'REVERSAL_INITIATED', 'REVERSED', 'COMPLETED', 'FAILED', 'EXPIRED', 'DEEMED');--> statement-breakpoint
CREATE TYPE "public"."vpa_status" AS ENUM('ACTIVE', 'INACTIVE', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "disputes" (
	"dispute_id" uuid PRIMARY KEY NOT NULL,
	"txn_id" uuid NOT NULL,
	"raised_by_org_id" uuid NOT NULL,
	"dispute_type" "dispute_type" NOT NULL,
	"status" "dispute_status" DEFAULT 'RAISED' NOT NULL,
	"evidence_path" varchar(512),
	"auto_verdict" varchar(50),
	"resolved_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_callbacks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pending_callbacks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid NOT NULL,
	"txn_id" uuid NOT NULL,
	"callback_type" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "callback_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" varchar(255) PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registered_orgs" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"org_type" "org_type" NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" "org_status" DEFAULT 'PENDING' NOT NULL,
	"public_key_pem" text,
	"mtls_cert_fingerprint" varchar(128),
	"api_endpoint" varchar(512),
	"dr_endpoint" varchar(512),
	"ip_whitelist" text[],
	"max_tps" integer DEFAULT 100 NOT NULL,
	"settlement_account_ifsc" varchar(11),
	"settlement_account_number_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_batches" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"cycle_start" timestamp with time zone NOT NULL,
	"cycle_end" timestamp with time zone NOT NULL,
	"status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"total_debits_paise" bigint DEFAULT 0 NOT NULL,
	"total_credits_paise" bigint DEFAULT 0 NOT NULL,
	"file_checksum" varchar(64),
	"file_path" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_entries" (
	"batch_id" uuid NOT NULL,
	"debtor_org_id" uuid NOT NULL,
	"creditor_org_id" uuid NOT NULL,
	"net_amount_paise" bigint NOT NULL,
	"txn_count" integer NOT NULL,
	CONSTRAINT "settlement_entries_batch_id_debtor_org_id_creditor_org_id_pk" PRIMARY KEY("batch_id","debtor_org_id","creditor_org_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"txn_id" uuid NOT NULL,
	"rrn" varchar(12) NOT NULL,
	"payer_vpa" varchar(255) NOT NULL,
	"payee_vpa" varchar(255) NOT NULL,
	"payer_ifsc" varchar(11),
	"payee_ifsc" varchar(11),
	"amount_paise" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"status" "txn_status" DEFAULT 'RECEIVED' NOT NULL,
	"org_txn_id" varchar(255),
	"psp_org_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transactions_pkey" PRIMARY KEY ("txn_id", "created_at"),
	CONSTRAINT "uq_psp_org_txn" UNIQUE("psp_org_id","org_txn_id","created_at"),
	CONSTRAINT "amount_positive" CHECK ("transactions"."amount_paise" > 0)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE TABLE "txn_audit_log" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "txn_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"txn_id" uuid NOT NULL,
	"from_state" "txn_status",
	"to_state" "txn_status" NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" varchar(64),
	"hash" varchar(64) NOT NULL,
	CONSTRAINT "txn_audit_log_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE (timestamp);
--> statement-breakpoint
CREATE TABLE "vpa_handles" (
	"handle" varchar(50) PRIMARY KEY NOT NULL,
	"owning_org_id" uuid NOT NULL,
	"status" "vpa_status" DEFAULT 'ACTIVE' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vpa_mappings" (
	"vpa_address" varchar(255) PRIMARY KEY NOT NULL,
	"handle" varchar(50) NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"ifsc" varchar(11) NOT NULL,
	"bank_org_id" uuid NOT NULL,
	"psp_org_id" uuid NOT NULL,
	"status" "vpa_status" DEFAULT 'ACTIVE' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deregistered_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("raised_by_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_callbacks" ADD CONSTRAINT "pending_callbacks_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_batch_id_settlement_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batches"("batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_debtor_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("debtor_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_creditor_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("creditor_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpa_handles" ADD CONSTRAINT "vpa_handles_owning_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("owning_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpa_mappings" ADD CONSTRAINT "vpa_mappings_handle_vpa_handles_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."vpa_handles"("handle") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpa_mappings" ADD CONSTRAINT "vpa_mappings_bank_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("bank_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpa_mappings" ADD CONSTRAINT "vpa_mappings_psp_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("psp_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dispute_txn" ON "disputes" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "idx_dispute_status" ON "disputes" USING btree ("status") WHERE status IN ('RAISED', 'UNDER_REVIEW');--> statement-breakpoint
CREATE INDEX "idx_outbox_unpublished" ON "outbox_events" USING btree ("created_at") WHERE published = false;--> statement-breakpoint
CREATE INDEX "idx_callback_pending" ON "pending_callbacks" USING btree ("next_attempt_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "idx_callback_txn" ON "pending_callbacks" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "idx_org_status" ON "registered_orgs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_txn_rrn" ON "transactions" USING btree ("rrn");--> statement-breakpoint
CREATE INDEX "idx_txn_payer_vpa" ON "transactions" USING btree ("payer_vpa","created_at");--> statement-breakpoint
CREATE INDEX "idx_txn_payee_vpa" ON "transactions" USING btree ("payee_vpa","created_at");--> statement-breakpoint
CREATE INDEX "idx_txn_status" ON "transactions" USING btree ("status") WHERE status IN ('RECEIVED', 'VPA_RESOLVED', 'DEBIT_INITIATED', 'CREDIT_INITIATED');--> statement-breakpoint
CREATE INDEX "idx_txn_expires" ON "transactions" USING btree ("expires_at") WHERE status IN ('RECEIVED', 'VPA_RESOLVED');--> statement-breakpoint
CREATE INDEX "idx_txn_psp_org" ON "transactions" USING btree ("psp_org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_txn_id" ON "txn_audit_log" USING btree ("txn_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_vpa_handle" ON "vpa_mappings" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "idx_vpa_bank_org" ON "vpa_mappings" USING btree ("bank_org_id");--> statement-breakpoint
CREATE INDEX "idx_vpa_psp_org" ON "vpa_mappings" USING btree ("psp_org_id");--> statement-breakpoint
CREATE INDEX "idx_vpa_status" ON "vpa_mappings" USING btree ("status") WHERE status = 'ACTIVE';--> statement-breakpoint

-- ── Partition helper functions ────────────────────────

CREATE OR REPLACE FUNCTION create_txn_partition(partition_date DATE)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  partition_name := 'transactions_' || TO_CHAR(partition_date, 'YYYYMMDD');
  start_date := partition_date;
  end_date := partition_date + INTERVAL '1 day';
  EXECUTE FORMAT(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF transactions FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION create_audit_partition(partition_month DATE)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  partition_name := 'txn_audit_log_' || TO_CHAR(partition_month, 'YYYYMM');
  start_date := DATE_TRUNC('month', partition_month);
  end_date := DATE_TRUNC('month', partition_month) + INTERVAL '1 month';
  EXECUTE FORMAT(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF txn_audit_log FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ── Create initial partitions ─────────────────────────

DO $$
BEGIN
  FOR i IN 0..7 LOOP
    PERFORM create_txn_partition(CURRENT_DATE + i);
  END LOOP;
  PERFORM create_audit_partition(DATE_TRUNC('month', CURRENT_DATE)::DATE);
  PERFORM create_audit_partition((DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::DATE);
END $$;