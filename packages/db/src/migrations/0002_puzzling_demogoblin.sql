CREATE TYPE "public"."execution_status" AS ENUM('PENDING', 'EXECUTING', 'EXECUTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."sender_type" AS ENUM('CONTACT', 'USER', 'SYSTEM', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('MANUAL', 'SIMULATION', 'OUTLOOK', 'PROPERTYME', 'GROW');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('SYNCED', 'PENDING', 'STALE', 'ERROR', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('ROUTINE', 'ENTRY', 'EXIT', 'OPEN_HOME');--> statement-breakpoint
CREATE TYPE "public"."lease_status" AS ENUM('DRAFT', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'TERMINATED', 'RENEWED');--> statement-breakpoint
CREATE TYPE "public"."maintenance_job_status" AS ENUM('LOGGED', 'QUOTE_PENDING', 'AWAITING_OWNER_APPROVAL', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tenancy_status" AS ENUM('FUTURE', 'CURRENT', 'NOTICE_GIVEN', 'ENDED');--> statement-breakpoint
CREATE TABLE "action_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"execution_key" text NOT NULL,
	"status" "execution_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"external_ref" text,
	"connector" text DEFAULT 'mock-email' NOT NULL,
	"correlation_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_entity_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "source_system" NOT NULL,
	"source_account_id" text,
	"external_entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"local_entity_type" text NOT NULL,
	"local_entity_id" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"source_hash" text,
	"sync_status" "sync_status" DEFAULT 'SYNCED' NOT NULL,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text NOT NULL,
	"type" "inspection_type" DEFAULT 'ROUTINE' NOT NULL,
	"status" "inspection_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "property_source" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"source_status" text DEFAULT 'ACTIVE' NOT NULL,
	"source_deleted_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"source_hash" text,
	"sync_status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"sync_error" text
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text NOT NULL,
	"primary_tenant_contact_id" text,
	"status" "lease_status" DEFAULT 'ACTIVE' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"rent_amount" numeric(12, 2),
	"rent_frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"bond_amount" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "property_source" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"source_status" text DEFAULT 'ACTIVE' NOT NULL,
	"source_deleted_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"source_hash" text,
	"sync_status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"sync_error" text
);
--> statement-breakpoint
CREATE TABLE "maintenance_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text NOT NULL,
	"title" text NOT NULL,
	"issue" text,
	"status" "maintenance_job_status" DEFAULT 'LOGGED' NOT NULL,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"trade_name" text,
	"quote_amount" numeric(12, 2),
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "property_source" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"source_status" text DEFAULT 'ACTIVE' NOT NULL,
	"source_deleted_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"source_hash" text,
	"sync_status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"sync_error" text
);
--> statement-breakpoint
CREATE TABLE "tenancies" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text NOT NULL,
	"tenant_contact_id" text NOT NULL,
	"status" "tenancy_status" DEFAULT 'CURRENT' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"rent_amount" numeric(12, 2),
	"rent_frequency" text DEFAULT 'WEEKLY' NOT NULL,
	"bond_amount" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "property_source" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"source_status" text DEFAULT 'ACTIVE' NOT NULL,
	"source_deleted_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"source_hash" text,
	"sync_status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"sync_error" text
);
--> statement-breakpoint
DROP INDEX "property_contacts_uidx";--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "sender_type" "sender_type" DEFAULT 'CONTACT' NOT NULL;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "sender_user_id" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "sender_data" jsonb;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source" "source_system" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source_account_id" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "external_message_id" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "external_conversation_id" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "business_domain" "business_domain";--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "case_type" "case_type";--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "action_required" "action_required";--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "classification_confidence" real;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "classification_source" text;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN "risk_level" "risk_level";--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "risk_level" "risk_level";--> statement-breakpoint
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_action_id_ai_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ai_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_primary_tenant_contact_id_contacts_id_fk" FOREIGN KEY ("primary_tenant_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_tenant_contact_id_contacts_id_fk" FOREIGN KEY ("tenant_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_executions_key_uidx" ON "action_executions" USING btree ("execution_key");--> statement-breakpoint
CREATE INDEX "action_executions_action_idx" ON "action_executions" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_mappings_uidx" ON "external_entity_mappings" USING btree ("source","external_entity_type","external_id");--> statement-breakpoint
CREATE INDEX "external_mappings_local_idx" ON "external_entity_mappings" USING btree ("local_entity_type","local_entity_id");--> statement-breakpoint
CREATE INDEX "inspections_property_idx" ON "inspections" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_source_uidx" ON "inspections" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "leases_property_idx" ON "leases" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leases_source_uidx" ON "leases" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "maintenance_jobs_property_idx" ON "maintenance_jobs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "maintenance_jobs_status_idx" ON "maintenance_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_jobs_source_uidx" ON "maintenance_jobs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "tenancies_property_idx" ON "tenancies" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "tenancies_tenant_idx" ON "tenancies" USING btree ("tenant_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenancies_source_uidx" ON "tenancies" USING btree ("source","external_id");--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_contacts_period_uidx" ON "property_contacts" USING btree ("property_id","contact_id","role","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "property_contacts_active_uidx" ON "property_contacts" USING btree ("property_id","contact_id","role") WHERE "property_contacts"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "property_contacts_property_role_idx" ON "property_contacts" USING btree ("property_id","role");--> statement-breakpoint
CREATE INDEX "communications_conversation_idx" ON "communications" USING btree ("external_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communications_source_message_uidx" ON "communications" USING btree ("source","source_account_id","external_message_id");