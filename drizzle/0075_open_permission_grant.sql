CREATE TABLE "open_permission_grant" (
	"community_id" uuid NOT NULL,
	"module_key" "permission_grant_module" NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by" uuid NOT NULL,
	CONSTRAINT "open_permission_grant_community_id_module_key_pk" PRIMARY KEY("community_id","module_key")
);
--> statement-breakpoint
ALTER TABLE "open_permission_grant" ADD CONSTRAINT "open_permission_grant_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_permission_grant" ADD CONSTRAINT "open_permission_grant_opened_by_member_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;