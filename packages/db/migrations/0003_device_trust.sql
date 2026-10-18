ALTER TABLE "devices" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_ip" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_user_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "devices_tenant_status" ON "devices" USING btree ("tenant_id","status");--> statement-breakpoint
-- Tills that existed before device trust keep working: they were already in use by the store.
UPDATE "devices" SET "status" = 'approved', "approved_at" = now() WHERE "status" = 'pending';
