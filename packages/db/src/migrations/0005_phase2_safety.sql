ALTER TYPE "public"."execution_status" ADD VALUE 'RECONCILIATION_REQUIRED';--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "idempotency_key" text;