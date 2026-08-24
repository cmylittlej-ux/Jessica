ALTER TABLE "cases" ADD COLUMN "maintenance_job_id" text;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_maintenance_job_id_maintenance_jobs_id_fk" FOREIGN KEY ("maintenance_job_id") REFERENCES "public"."maintenance_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_maintenance_job_idx" ON "cases" USING btree ("maintenance_job_id");