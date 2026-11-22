CREATE TABLE "community_icon" (
	"community_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_icon_community_id_variant_pk" PRIMARY KEY("community_id","variant")
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "icon_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "icon_file_name" text;--> statement-breakpoint
ALTER TABLE "community_icon" ADD CONSTRAINT "community_icon_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE cascade ON UPDATE no action;