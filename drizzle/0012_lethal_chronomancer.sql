CREATE TABLE "wiki_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"branch_id" uuid,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question_pending" boolean DEFAULT false NOT NULL,
	"duplicate_of_page_id" uuid
);
--> statement-breakpoint
CREATE TABLE "wiki_page_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"content" text NOT NULL,
	"edited_by" uuid NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_duplicate_of_page_id_wiki_page_id_fk" FOREIGN KEY ("duplicate_of_page_id") REFERENCES "public"."wiki_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_page_id_wiki_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_edited_by_member_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;