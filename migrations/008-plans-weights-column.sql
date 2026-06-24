-- Migration: add Plans.weights for per-exercise weight logging
--
-- Customers log the weight they used for each exercise on each
-- session. Stored as JSONB keyed by "week.session.exercise" (e.g.
-- "1.2.3" = week 1, session 2, exercise 3); value is the chosen
-- option (e.g. "65", "BW", "2.5").
--
-- Run in Supabase SQL editor.

ALTER TABLE "Plans"
  ADD COLUMN IF NOT EXISTS weights JSONB NOT NULL DEFAULT '{}'::jsonb;
