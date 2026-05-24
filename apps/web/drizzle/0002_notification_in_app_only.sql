ALTER TABLE "public"."notifications" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."notification_channel";--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app');--> statement-breakpoint
ALTER TABLE "public"."notifications" ALTER COLUMN "channel" SET DATA TYPE "public"."notification_channel" USING "channel"::"public"."notification_channel";