CREATE TYPE "public"."recon_mismatch_type" AS ENUM('PHANTOM', 'MISSED', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH');--> statement-breakpoint
CREATE TABLE "recon_mismatches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recon_mismatches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"report_id" bigint NOT NULL,
	"rrn" varchar(12) NOT NULL,
	"mismatch_type" "recon_mismatch_type" NOT NULL,
	"switch_amount_paise" bigint,
	"bank_amount_paise" bigint,
	"switch_status" "txn_status",
	"bank_status" varchar(50),
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recon_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" uuid NOT NULL,
	"bank_org_id" uuid NOT NULL,
	"cycle_start" timestamp with time zone NOT NULL,
	"cycle_end" timestamp with time zone NOT NULL,
	"total_switch_txns" integer NOT NULL,
	"total_bank_txns" integer NOT NULL,
	"matched_count" integer NOT NULL,
	"mismatch_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recon_mismatches" ADD CONSTRAINT "recon_mismatches_report_id_recon_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."recon_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_reports" ADD CONSTRAINT "recon_reports_bank_org_id_registered_orgs_org_id_fk" FOREIGN KEY ("bank_org_id") REFERENCES "public"."registered_orgs"("org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recon_mismatch_report" ON "recon_mismatches" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "idx_recon_mismatch_rrn" ON "recon_mismatches" USING btree ("rrn");--> statement-breakpoint
CREATE INDEX "idx_recon_batch" ON "recon_reports" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_txn_deemed" ON "transactions" USING btree ("status","updated_at") WHERE status = 'DEEMED';--> statement-breakpoint
CREATE INDEX "idx_txn_completed_at" ON "transactions" USING btree ("completed_at") WHERE status = 'COMPLETED';