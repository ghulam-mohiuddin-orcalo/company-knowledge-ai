CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ingestion_job_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"page_number" integer,
	"section_path" text,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_document_id_chunk_index_key" UNIQUE("document_id","chunk_index"),
	CONSTRAINT "document_chunks_chunk_index_non_negative" CHECK ("document_chunks"."chunk_index" >= 0),
	CONSTRAINT "document_chunks_token_count_positive" CHECK ("document_chunks"."token_count" > 0),
	CONSTRAINT "document_chunks_char_range_valid" CHECK ("document_chunks"."char_start" >= 0 AND "document_chunks"."char_end" >= "document_chunks"."char_start")
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_ingestion_job_id_ingestion_jobs_id_fk" FOREIGN KEY ("ingestion_job_id") REFERENCES "public"."ingestion_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_tenant_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."documents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_organization_id_document_id_idx" ON "document_chunks" USING btree ("organization_id","document_id");