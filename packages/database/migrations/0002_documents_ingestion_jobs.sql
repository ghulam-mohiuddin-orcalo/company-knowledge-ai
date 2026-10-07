CREATE TYPE "public"."document_status" AS ENUM('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'DELETING', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_status" AS ENUM('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"status" "document_status" DEFAULT 'QUEUED' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "documents_id_organization_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "documents_size_bytes_positive" CHECK ("documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "ingestion_job_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_detail_safe" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ingestion_jobs_attempt_non_negative" CHECK ("ingestion_jobs"."attempt" >= 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_tenant_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."documents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_organization_id_status_created_at_idx" ON "documents" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingestion_jobs_status_next_attempt_at_idx" ON "ingestion_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_organization_id_document_id_idx" ON "ingestion_jobs" USING btree ("organization_id","document_id");