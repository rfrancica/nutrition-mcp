-- Browser sessions for the read-only nutrition dashboard.
--
-- Distinct from oauth_tokens (which authenticate the /mcp endpoint for AI
-- clients): these back an HttpOnly cookie issued after an email/password login
-- on the dashboard. The server reads this table with the service-role key, so
-- RLS is enabled with no policies — anon and authenticated roles get nothing,
-- only the service role (which bypasses RLS) can touch it.

CREATE TABLE IF NOT EXISTS "public"."dashboard_sessions" (
    "token" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_sessions_pkey" PRIMARY KEY ("token")
);

ALTER TABLE "public"."dashboard_sessions" OWNER TO "postgres";

ALTER TABLE "public"."dashboard_sessions" ENABLE ROW LEVEL SECURITY;

-- Speeds up the per-user fan-out on account deletion and any future "list my
-- sessions" view.
CREATE INDEX IF NOT EXISTS "dashboard_sessions_user_id_idx"
    ON "public"."dashboard_sessions" ("user_id");

-- Lets expired-session cleanup scan by expiry cheaply.
CREATE INDEX IF NOT EXISTS "dashboard_sessions_expires_at_idx"
    ON "public"."dashboard_sessions" ("expires_at");
