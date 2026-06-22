-- Migration: drop the coach approval-gate tables
--
-- The original v1 team-plans design had a coach application step
-- (apply → admin approves → coach signs in → generates plan). It was
-- replaced with the same shape as the individual plan flow: a public
-- intake form that lands a team plan in the admin review queue. No
-- pre-approval, no coach accounts. This migration removes the tables
-- that supported the old gate.
--
-- The Plans table retains its team plan columns (is_team_plan,
-- share_token, coach_id, team_intake_data). coach_id is left for
-- backwards compatibility but is always NULL on new team plans;
-- coach contact lives in the team_intake_data JSONB instead.
--
-- Run in Supabase SQL editor.

DROP TABLE IF EXISTS coach_applications;
DROP TABLE IF EXISTS coaches;
