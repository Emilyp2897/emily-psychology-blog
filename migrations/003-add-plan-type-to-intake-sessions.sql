-- Migration: add a plan_type column so intake_sessions can hold both
-- physical training plans and mental performance plans.
--
-- Default is 'physical' so existing rows (all of which are physical plans
-- from before this column existed) carry the correct value.

ALTER TABLE intake_sessions
  ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'physical';

-- Index for filtering by plan_type when reviewing.
CREATE INDEX IF NOT EXISTS idx_intake_sessions_plan_type
  ON intake_sessions(plan_type);
