-- Migration: allow Plans.user_id to be NULL for team plans
--
-- Individual customer plans always have a user_id (the Supabase Auth
-- user who paid). Team plans have no Supabase Auth user — the coach's
-- contact lives in team_intake_data instead. So user_id needs to be
-- nullable.
--
-- Run in Supabase SQL editor.

ALTER TABLE "Plans"
  ALTER COLUMN user_id DROP NOT NULL;
