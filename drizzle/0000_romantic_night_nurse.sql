CREATE TABLE "account_deletion_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_hash" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_session_calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buddy_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"google_event_id" text,
	"html_link" text,
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_session_calendar_events_status_allowed" CHECK ("buddy_session_calendar_events"."status" in ('created', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "buddy_session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buddy_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"participant_completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buddy_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_token" varchar(48) NOT NULL,
	"host_user_id" uuid NOT NULL,
	"state" varchar(20) DEFAULT 'waiting' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"daily_room_name" varchar(128),
	"daily_room_url" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_sessions_share_token_unique" UNIQUE("share_token"),
	CONSTRAINT "buddy_sessions_state_allowed" CHECK ("buddy_sessions"."state" in ('waiting', 'ready_check', 'active', 'completed', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(20) NOT NULL,
	"token" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"apns_environment" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_platform_allowed" CHECK ("device_tokens"."platform" in ('ios')),
	CONSTRAINT "device_tokens_apns_environment_allowed" CHECK ("device_tokens"."apns_environment" in ('development', 'production'))
);
--> statement-breakpoint
CREATE TABLE "friend_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "friend_requests_no_self" CHECK ("friend_requests"."from_user_id" <> "friend_requests"."to_user_id"),
	CONSTRAINT "friend_requests_status_allowed" CHECK ("friend_requests"."status" in ('pending', 'accepted', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user1_id" uuid NOT NULL,
	"user2_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user1_id_user2_id_pk" PRIMARY KEY("user1_id","user2_id"),
	CONSTRAINT "friendships_user_order" CHECK ("friendships"."user1_id" < "friendships"."user2_id")
);
--> statement-breakpoint
CREATE TABLE "google_oauth_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"google_sub" varchar(255),
	"google_email" varchar(255),
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"scope" text NOT NULL,
	"token_type" varchar(32) DEFAULT 'Bearer' NOT NULL,
	"expiry_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_provider_allowed" CHECK ("oauth_accounts"."provider" in ('google', 'apple', 'facebook', 'microsoft-entra-id'))
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"request_ip_hash" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"buddy_session_id" uuid,
	"day_number" integer NOT NULL,
	"session_type" varchar(20) DEFAULT 'standard' NOT NULL,
	"duration" integer NOT NULL,
	"completed" boolean NOT NULL,
	"actual_time" integer,
	"clear_percent" integer NOT NULL,
	"thought_count" integer DEFAULT 0 NOT NULL,
	"mind_state_log" jsonb,
	"session_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_type_allowed" CHECK ("sessions"."session_type" in ('standard', 'quick'))
);
--> statement-breakpoint
CREATE TABLE "thoughts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"time_in_session" integer NOT NULL,
	"text" varchar(1000) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" varchar(255),
	"is_public" boolean DEFAULT false NOT NULL,
	"current_day" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "buddy_session_calendar_events" ADD CONSTRAINT "buddy_session_calendar_events_buddy_session_id_buddy_sessions_id_fk" FOREIGN KEY ("buddy_session_id") REFERENCES "public"."buddy_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_session_calendar_events" ADD CONSTRAINT "buddy_session_calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_session_participants" ADD CONSTRAINT "buddy_session_participants_buddy_session_id_buddy_sessions_id_fk" FOREIGN KEY ("buddy_session_id") REFERENCES "public"."buddy_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_session_participants" ADD CONSTRAINT "buddy_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_sessions" ADD CONSTRAINT "buddy_sessions_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_oauth_tokens" ADD CONSTRAINT "google_oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_buddy_session_id_buddy_sessions_id_fk" FOREIGN KEY ("buddy_session_id") REFERENCES "public"."buddy_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_deletion_log_email_hash" ON "account_deletion_log" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "idx_account_deletion_log_user" ON "account_deletion_log" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_session_calendar_events_session_user" ON "buddy_session_calendar_events" USING btree ("buddy_session_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_buddy_session_calendar_events_session" ON "buddy_session_calendar_events" USING btree ("buddy_session_id");--> statement-breakpoint
CREATE INDEX "idx_buddy_session_calendar_events_user" ON "buddy_session_calendar_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_session_participants_session_user" ON "buddy_session_participants" USING btree ("buddy_session_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_buddy_sessions_host" ON "buddy_sessions" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "idx_device_tokens_user_enabled" ON "device_tokens" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_hash_env_unique" ON "device_tokens" USING btree ("token_hash","apns_environment");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_pending_user_pair" ON "friend_requests" USING btree (least("from_user_id", "to_user_id"),greatest("from_user_id", "to_user_id")) WHERE "friend_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_friend_requests_from" ON "friend_requests" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "idx_friend_requests_to" ON "friend_requests" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "idx_friendships_user1" ON "friendships" USING btree ("user1_id");--> statement-breakpoint
CREATE INDEX "idx_friendships_user2" ON "friendships" USING btree ("user2_id");--> statement-breakpoint
CREATE INDEX "idx_google_oauth_tokens_email" ON "google_oauth_tokens" USING btree ("google_email");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_account_unique" ON "oauth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_accounts_user" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_password_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_active_user_unique" ON "password_reset_tokens" USING btree ("user_id") WHERE "password_reset_tokens"."used_at" is null;--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id","day_number");--> statement-breakpoint
CREATE INDEX "idx_sessions_buddy_session" ON "sessions" USING btree ("buddy_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_user_buddy_session_unique" ON "sessions" USING btree ("user_id","buddy_session_id") WHERE "sessions"."buddy_session_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_thoughts_user" ON "thoughts" USING btree ("user_id","day_number");--> statement-breakpoint
CREATE INDEX "idx_users_public" ON "users" USING btree ("is_public");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" USING btree (lower("username"));