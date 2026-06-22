-- Migration: pilot feedback table
--
-- Stores one row per customer's weekly feedback submission. Powers
-- the popup that appears on /plan/[id] after a customer ticks the
-- last exercise of a week + the /admin/feedback dashboard.
--
-- Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS plan_week_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL,
  user_id         UUID NOT NULL,
  week_number     INTEGER NOT NULL,
  rating          INTEGER,
  worked_well     TEXT,
  was_hard        TEXT,
  notes_for_emily TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_week_feedback_plan ON plan_week_feedback(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_week_feedback_user ON plan_week_feedback(user_id);
