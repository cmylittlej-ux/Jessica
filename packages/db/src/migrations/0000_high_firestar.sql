CREATE TYPE "public"."action_required" AS ENUM('URGENT_ACTION', 'DECISION_REQUIRED', 'APPROVAL_REQUIRED', 'REPLY_REQUIRED', 'FOLLOW_UP_REQUIRED', 'WAITING_FOR_OTHER', 'INFORMATION_ONLY', 'NO_ACTION');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('USER', 'AI', 'SYSTEM', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."ai_action_status" AS ENUM('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ai_action_type" AS ENUM('CLASSIFY_COMMUNICATION', 'SUMMARISE_CASE', 'RECOMMEND_ACTIONS', 'GENERATE_REPLY', 'TRANSLATE', 'SEND_EMAIL', 'CREATE_TASK');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."business_domain" AS ENUM('PROPERTY_MANAGEMENT', 'SALES', 'ADMINISTRATION', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."case_type" AS ENUM('MAINTENANCE', 'RENT', 'ARREARS', 'LEASE', 'LEASE_RENEWAL', 'VACATE', 'INSPECTION', 'OWNER_REQUEST', 'TENANT_REQUEST', 'INVOICE', 'QUOTE', 'COMPLIANCE', 'KEYS', 'BOND', 'UTILITIES', 'COMPLAINT', 'GENERAL_PM', 'BUYER_ENQUIRY', 'BUYER_FOLLOW_UP', 'VENDOR', 'LISTING', 'OPEN_INSPECTION', 'OFFER', 'NEGOTIATION', 'CONTRACT', 'FINANCE', 'BUILDING_INSPECTION', 'DEPOSIT', 'SETTLEMENT', 'ADVERTISING', 'SOLICITOR_SALES', 'GENERAL_SALES', 'INTERNAL', 'MARKETING', 'NEWSLETTER', 'SYSTEM_NOTIFICATION', 'SPAM', 'OTHER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('EMAIL', 'SMS', 'PHONE', 'NOTE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."communication_status" AS ENUM('RECEIVED', 'PENDING_SEND', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('OWNER', 'TENANT', 'BUYER', 'VENDOR', 'SOLICITOR', 'TRADESPERSON', 'BROKER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."created_by_type" AS ENUM('USER', 'AI', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('INBOUND', 'OUTBOUND', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('ACCEPTED', 'EDITED', 'REJECTED', 'RECLASSIFIED');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('CRITICAL', 'HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."property_source" AS ENUM('MANUAL', 'PROPERTYME', 'GROW', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('AVAILABLE', 'UNDER_OFFER', 'SOLD', 'LEASED', 'OFF_MARKET', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('HOUSE', 'UNIT', 'APARTMENT', 'TOWNHOUSE', 'LAND', 'COMMERCIAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('AI', 'HUMAN', 'WORKFLOW');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'AGENT', 'PROPERTY_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('NEW', 'AI_PROCESSING', 'READY_FOR_REVIEW', 'IN_PROGRESS', 'WAITING', 'FOLLOW_UP_DUE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Australia/Melbourne' NOT NULL,
	"default_language" text DEFAULT 'zh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"working_language" text DEFAULT 'zh' NOT NULL,
	"role" "user_role" NOT NULL,
	"ai_autonomy_level" text DEFAULT 'STANDARD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"suburb" text NOT NULL,
	"state" text DEFAULT 'VIC' NOT NULL,
	"postcode" text NOT NULL,
	"country" text DEFAULT 'Australia' NOT NULL,
	"property_type" "property_type" NOT NULL,
	"status" "property_status" NOT NULL,
	"source" "property_source" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" "contact_role" NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text,
	"title" text NOT NULL,
	"business_domain" "business_domain" NOT NULL,
	"case_type" "case_type" NOT NULL,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "workflow_status" DEFAULT 'NEW' NOT NULL,
	"summary" text,
	"assigned_user_id" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text,
	"property_id" text,
	"direction" "direction" NOT NULL,
	"channel" "channel" NOT NULL,
	"sender_contact_id" text,
	"recipient_data" jsonb,
	"subject" text,
	"original_content" text NOT NULL,
	"original_language" text DEFAULT 'en' NOT NULL,
	"translated_content_zh" text,
	"translated_content_en" text,
	"status" "communication_status" DEFAULT 'RECEIVED' NOT NULL,
	"external_id" text,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text,
	"property_id" text,
	"assigned_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "task_status" DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"source" "task_source" DEFAULT 'HUMAN' NOT NULL,
	"created_by_type" "created_by_type" DEFAULT 'USER' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text,
	"action_type" "ai_action_type" NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"model" text DEFAULT 'mock-1' NOT NULL,
	"input_summary" text,
	"proposed_payload" jsonb NOT NULL,
	"final_payload" jsonb,
	"confidence" real,
	"status" "ai_action_status" DEFAULT 'PROPOSED' NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_feedbacks" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_action_id" text NOT NULL,
	"user_id" text NOT NULL,
	"original_output" jsonb NOT NULL,
	"final_output" jsonb,
	"feedback_type" "feedback_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text,
	"action_id" text NOT NULL,
	"requested_user_id" text NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"decision_note" text
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text,
	"case_id" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"activity_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_sender_contact_id_contacts_id_fk" FOREIGN KEY ("sender_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedbacks" ADD CONSTRAINT "ai_feedbacks_ai_action_id_ai_actions_id_fk" FOREIGN KEY ("ai_action_id") REFERENCES "public"."ai_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedbacks" ADD CONSTRAINT "ai_feedbacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_action_id_ai_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ai_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_user_id_users_id_fk" FOREIGN KEY ("requested_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_agency_idx" ON "users" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_agency_idx" ON "contacts" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "properties_agency_idx" ON "properties" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "properties_suburb_idx" ON "properties" USING btree ("suburb");--> statement-breakpoint
CREATE UNIQUE INDEX "property_contacts_uidx" ON "property_contacts" USING btree ("property_id","contact_id","role");--> statement-breakpoint
CREATE INDEX "property_contacts_contact_idx" ON "property_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "cases_agency_status_idx" ON "cases" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX "cases_property_idx" ON "cases" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "communications_case_idx" ON "communications" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "communications_sender_idx" ON "communications" USING btree ("sender_contact_id");--> statement-breakpoint
CREATE INDEX "tasks_case_idx" ON "tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "ai_actions_case_idx" ON "ai_actions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "ai_actions_status_idx" ON "ai_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_feedbacks_action_idx" ON "ai_feedbacks" USING btree ("ai_action_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "activities_case_idx" ON "activities" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "activities_property_idx" ON "activities" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");