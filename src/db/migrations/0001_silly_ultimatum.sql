CREATE TABLE "link_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "escalation_reason" varchar(50);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "failure_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "triage_state" jsonb;--> statement-breakpoint
ALTER TABLE "link_sessions" ADD CONSTRAINT "link_sessions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;