CREATE TYPE "public"."account_mode" AS ENUM('preview', 'auto');--> statement-breakpoint
CREATE TYPE "public"."decision_action" AS ENUM('keep', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('ntfy', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reason_code" AS ENUM('low_ctr_no_carts', 'banned_keyword', 'insufficient_data', 'protected_by_cart', 'protected_by_order', 'protected_top_weak', 'protected_min_alive', 'above_threshold');--> statement-breakpoint
CREATE TYPE "public"."run_mode" AS ENUM('preview', 'auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"advert_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" integer,
	"median_ctr" double precision,
	"is_weak" boolean DEFAULT false NOT NULL,
	"daily_stats" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"advert_id" bigint NOT NULL,
	"nm_id" bigint NOT NULL,
	"norm_query" text NOT NULL,
	"action" "decision_action" NOT NULL,
	"reason_code" "reason_code" NOT NULL,
	"ctr" double precision,
	"views" integer,
	"clicks" integer,
	"carts" integer,
	"orders" integer,
	"was_applied" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "minus_cache" (
	"wb_account_id" uuid NOT NULL,
	"advert_id" bigint NOT NULL,
	"nm_id" bigint NOT NULL,
	"phrase" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "minus_cache_pk" PRIMARY KEY("wb_account_id","advert_id","nm_id","phrase")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"target" text NOT NULL,
	"payload" jsonb,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rules_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"min_views" integer NOT NULL,
	"min_ctr" double precision NOT NULL,
	"weak_campaign_ctr" double precision NOT NULL,
	"min_carts_to_protect" integer DEFAULT 1 NOT NULL,
	"top_keep_pct" double precision NOT NULL,
	"min_clusters_alive" integer DEFAULT 3 NOT NULL,
	"banned_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"use_dynamic_ctr" boolean DEFAULT false NOT NULL,
	"min_dynamic_ctr" double precision DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wb_account_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"mode" "run_mode" NOT NULL,
	"summary" jsonb,
	"error_text" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wb_account_rules" (
	"wb_account_id" uuid PRIMARY KEY NOT NULL,
	"rules_profile_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wb_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"token_valid_until" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"validation_error" text,
	"mode" "account_mode" DEFAULT 'preview' NOT NULL,
	"preview_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_snapshots" ADD CONSTRAINT "campaign_snapshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "minus_cache" ADD CONSTRAINT "minus_cache_wb_account_id_wb_accounts_id_fk" FOREIGN KEY ("wb_account_id") REFERENCES "public"."wb_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules_profiles" ADD CONSTRAINT "rules_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_wb_account_id_wb_accounts_id_fk" FOREIGN KEY ("wb_account_id") REFERENCES "public"."wb_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wb_account_rules" ADD CONSTRAINT "wb_account_rules_wb_account_id_wb_accounts_id_fk" FOREIGN KEY ("wb_account_id") REFERENCES "public"."wb_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wb_account_rules" ADD CONSTRAINT "wb_account_rules_rules_profile_id_rules_profiles_id_fk" FOREIGN KEY ("rules_profile_id") REFERENCES "public"."rules_profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wb_accounts" ADD CONSTRAINT "wb_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_snapshots_run_id_idx" ON "campaign_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_run_id_idx" ON "decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_advert_nm_idx" ON "decisions" USING btree ("advert_id","nm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_action_idx" ON "decisions" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "minus_cache_account_advert_nm_idx" ON "minus_cache" USING btree ("wb_account_id","advert_id","nm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rules_profiles_user_id_idx" ON "rules_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rules_profiles_preset_name_uq" ON "rules_profiles" USING btree ("name") WHERE is_preset = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_account_started_idx" ON "runs" USING btree ("wb_account_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wb_accounts_user_id_idx" ON "wb_accounts" USING btree ("user_id");