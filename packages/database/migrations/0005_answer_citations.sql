ALTER TABLE "messages" ADD CONSTRAINT "messages_id_organization_id_key" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "answer_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid,
	"ordinal" integer NOT NULL,
	"source_label" text NOT NULL,
	"locator" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_citations_message_id_ordinal_key" UNIQUE("message_id","ordinal"),
	CONSTRAINT "answer_citations_message_id_source_label_key" UNIQUE("message_id","source_label"),
	CONSTRAINT "answer_citations_ordinal_positive" CHECK ("answer_citations"."ordinal" >= 1)
);
--> statement-breakpoint
ALTER TABLE "answer_citations" ADD CONSTRAINT "answer_citations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_citations" ADD CONSTRAINT "answer_citations_message_tenant_fk" FOREIGN KEY ("message_id","organization_id") REFERENCES "public"."messages"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_citations" ADD CONSTRAINT "answer_citations_document_tenant_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."documents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_citations_organization_id_document_id_idx" ON "answer_citations" USING btree ("organization_id","document_id");
