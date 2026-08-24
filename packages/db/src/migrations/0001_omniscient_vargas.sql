CREATE INDEX "communications_received_idx" ON "communications" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "tasks_property_idx" ON "tasks" USING btree ("property_id");