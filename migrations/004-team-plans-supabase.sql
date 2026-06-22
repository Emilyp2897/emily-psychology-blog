-- Migration: Team plans v1
-- Runs in SUPABASE (not Vercel Postgres). Paste into Supabase Dashboard
-- → SQL Editor → New query → Run.
--
-- Adds:
--   1. coach_applications: incoming "apply to be a coach" submissions.
--      Status: pending → approved/rejected. Reviewed manually by Emily.
--   2. coaches: approved coaches. Linked to a Supabase Auth user_id once
--      they sign up. Email is the bridge between application + user.
--   3. Plans table extension: is_team_plan flag, share_token (random
--      UUID for the public read-only URL), coach_id FK, team_intake_data
--      JSONB so team plans can be regenerated the same way customer
--      plans can.

-- 1. Coach applications
CREATE TABLE IF NOT EXISTS coach_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  club_name       TEXT,
  sport           TEXT,
  role            TEXT,
  group_size      TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_notes  TEXT
);
CREATE INDEX IF NOT EXISTS idx_coach_apps_status ON coach_applications(status);
CREATE INDEX IF NOT EXISTS idx_coach_apps_email  ON coach_applications(email);

-- 2. Approved coaches
CREATE TABLE IF NOT EXISTS coaches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,                      -- Supabase auth.users.id; null until they sign up
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  club_name   TEXT,
  sport       TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coaches_user_id ON coaches(user_id);

-- 3. Extend Plans for team plans
ALTER TABLE "Plans"
  ADD COLUMN IF NOT EXISTS is_team_plan      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS share_token       TEXT,
  ADD COLUMN IF NOT EXISTS coach_id          UUID,
  ADD COLUMN IF NOT EXISTS team_intake_data  JSONB;

-- Share token is the slug in /team-plan/[token]; must be unique when set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_share_token
  ON "Plans"(share_token)
  WHERE share_token IS NOT NULL;

-- Speeds up queries that filter team-only plans on the admin page.
CREATE INDEX IF NOT EXISTS idx_plans_is_team
  ON "Plans"(is_team_plan)
  WHERE is_team_plan = TRUE;
