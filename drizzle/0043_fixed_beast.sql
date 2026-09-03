ALTER TABLE "community" ADD COLUMN "oidc_issuer_url" text;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "oidc_client_id" text;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "oidc_required_role" text;--> statement-breakpoint
CREATE UNIQUE INDEX "member_identity_provider_subject_idx" ON "member_identity" USING btree ("provider","provider_subject");