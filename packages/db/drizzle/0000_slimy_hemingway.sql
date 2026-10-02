CREATE TYPE "public"."bid_status" AS ENUM('active', 'withdrawn', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."genre" AS ENUM('fitness', 'beauty', 'gaming', 'food', 'travel', 'tech', 'fashion', 'music');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('tiktok', 'instagram');--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "advertisers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bids_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"creator_id" bigint NOT NULL,
	"amount_cents" integer NOT NULL,
	"estimated_views" integer NOT NULL,
	"pricing_policy_version" text NOT NULL,
	"status" "bid_status" DEFAULT 'active' NOT NULL,
	"result_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_campaign_creator_unique" UNIQUE("campaign_id","creator_id"),
	CONSTRAINT "bids_amount_positive" CHECK ("bids"."amount_cents" > 0),
	CONSTRAINT "bids_estimated_views_nonnegative" CHECK ("bids"."estimated_views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_closings" (
	"campaign_id" bigint PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"algorithm_version" text NOT NULL,
	"bids_considered" integer NOT NULL,
	"winners_count" integer NOT NULL,
	"spend_cents" integer NOT NULL,
	"estimated_views_total" integer NOT NULL,
	"unused_budget_cents" integer NOT NULL,
	CONSTRAINT "campaign_closings_bids_considered_nonnegative" CHECK ("campaign_closings"."bids_considered" >= 0),
	CONSTRAINT "campaign_closings_winners_within_bids" CHECK ("campaign_closings"."winners_count" <= "campaign_closings"."bids_considered"),
	CONSTRAINT "campaign_closings_spend_nonnegative" CHECK ("campaign_closings"."spend_cents" >= 0),
	CONSTRAINT "campaign_closings_unused_nonnegative" CHECK ("campaign_closings"."unused_budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaigns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"advertiser_id" bigint NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"budget_cents" integer NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"platforms" "platform"[] NOT NULL,
	"genres" "genre"[] NOT NULL,
	"min_followers" integer DEFAULT 0 NOT NULL,
	"min_engagement_bps" integer DEFAULT 0 NOT NULL,
	"target_cpm_cents" integer NOT NULL,
	"max_cpm_cents" integer NOT NULL,
	"status" "campaign_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "campaigns_budget_positive" CHECK ("campaigns"."budget_cents" > 0),
	CONSTRAINT "campaigns_min_followers_nonnegative" CHECK ("campaigns"."min_followers" >= 0),
	CONSTRAINT "campaigns_min_engagement_bps_nonnegative" CHECK ("campaigns"."min_engagement_bps" >= 0),
	CONSTRAINT "campaigns_target_cpm_positive" CHECK ("campaigns"."target_cpm_cents" > 0),
	CONSTRAINT "campaigns_max_cpm_at_least_target" CHECK ("campaigns"."max_cpm_cents" >= "campaigns"."target_cpm_cents"),
	CONSTRAINT "campaigns_platforms_nonempty" CHECK (array_length("campaigns"."platforms", 1) > 0),
	CONSTRAINT "campaigns_genres_nonempty" CHECK (array_length("campaigns"."genres", 1) > 0),
	CONSTRAINT "campaigns_closed_at_matches_status" CHECK (("campaigns"."status" = 'open' AND "campaigns"."closed_at" IS NULL) OR ("campaigns"."status" = 'closed' AND "campaigns"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "creators_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"platform" "platform" NOT NULL,
	"genre" "genre" NOT NULL,
	"followers" integer NOT NULL,
	"engagement_bps" integer NOT NULL,
	"median_views" integer NOT NULL,
	"min_fee_cents" integer NOT NULL,
	CONSTRAINT "creators_handle_unique" UNIQUE("handle"),
	CONSTRAINT "creators_followers_nonnegative" CHECK ("creators"."followers" >= 0),
	CONSTRAINT "creators_engagement_bps_nonnegative" CHECK ("creators"."engagement_bps" >= 0),
	CONSTRAINT "creators_median_views_nonnegative" CHECK ("creators"."median_views" >= 0),
	CONSTRAINT "creators_min_fee_positive" CHECK ("creators"."min_fee_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_closings" ADD CONSTRAINT "campaign_closings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_campaign_status_idx" ON "bids" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "bids_creator_idx" ON "bids" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_deadline_idx" ON "campaigns" USING btree ("status","deadline_at");