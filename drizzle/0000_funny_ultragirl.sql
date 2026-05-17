CREATE TABLE IF NOT EXISTS "training_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"channel_id" text,
	"name" text,
	"niche" text,
	"language" text DEFAULT 'auto',
	"status" text DEFAULT 'pending',
	"total_videos" integer DEFAULT 0,
	"processed_videos" integer DEFAULT 0,
	"error_message" text,
	"added_by" text DEFAULT 'admin',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "training_sources_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"content_id" text NOT NULL,
	"content_url" text NOT NULL,
	"title" text,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"duration_seconds" integer,
	"language" text,
	"full_transcript" text,
	"hook_text" text,
	"body_text" text,
	"outro_text" text,
	"platform" text DEFAULT 'youtube',
	"published_at" timestamp,
	"scraped_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"hook_pattern" text,
	"hook_strength" integer,
	"body_structure" text,
	"transition_phrases" jsonb DEFAULT '[]'::jsonb,
	"cta_pattern" text,
	"recurring_phrases" jsonb DEFAULT '[]'::jsonb,
	"tone" text,
	"energy_level" text,
	"sentence_avg_length" integer,
	"language" text,
	"analyzed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "style_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"niche" text,
	"platform" text,
	"language" text,
	"best_hooks" jsonb DEFAULT '[]'::jsonb,
	"best_structures" jsonb DEFAULT '[]'::jsonb,
	"best_cta_patterns" jsonb DEFAULT '[]'::jsonb,
	"best_transitions" jsonb DEFAULT '[]'::jsonb,
	"vocabulary_bank" jsonb DEFAULT '[]'::jsonb,
	"tone" text,
	"energy_level" text,
	"full_analysis" text,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"instagram_connected" boolean DEFAULT false,
	"instagram_username" text,
	"instagram_access_token" text,
	"instagram_token_expiry" timestamp,
	"training_status" text DEFAULT 'none',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"content_id" text NOT NULL,
	"caption" text,
	"transcript" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"platform" text DEFAULT 'instagram',
	"published_at" timestamp,
	"scraped_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_personal_style" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"best_hooks" jsonb DEFAULT '[]'::jsonb,
	"best_structures" jsonb DEFAULT '[]'::jsonb,
	"best_cta_patterns" jsonb DEFAULT '[]'::jsonb,
	"vocabulary_bank" jsonb DEFAULT '[]'::jsonb,
	"tone" text,
	"energy_level" text,
	"language_mix" text,
	"signature_style" text,
	"full_analysis" text,
	"last_updated" timestamp DEFAULT now(),
	CONSTRAINT "user_personal_style_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generated_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"user_id" uuid,
	"platform" text NOT NULL,
	"niche" text,
	"language" text NOT NULL,
	"topic" text NOT NULL,
	"duration_seconds" integer,
	"script_content" text NOT NULL,
	"style_match_score" integer,
	"originality_score" integer,
	"platform_fit_score" integer,
	"hook_strength_score" integer,
	"tone" text DEFAULT 'motivational',
	"format" text,
	"target_audience" text,
	"key_message" text,
	"key_points" text,
	"additional_instructions" text,
	"sources_used" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_content" ADD CONSTRAINT "training_content_source_id_training_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."training_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_analysis" ADD CONSTRAINT "content_analysis_content_id_training_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."training_content"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "style_knowledge" ADD CONSTRAINT "style_knowledge_source_id_training_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."training_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_content" ADD CONSTRAINT "user_content_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_personal_style" ADD CONSTRAINT "user_personal_style_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_scripts" ADD CONSTRAINT "generated_scripts_source_id_training_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."training_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_scripts" ADD CONSTRAINT "generated_scripts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
