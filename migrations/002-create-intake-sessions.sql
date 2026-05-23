-- Migration: Create intake_sessions table
-- Stores intake form submissions and their generated teaser content while
-- waiting for the user to complete (or abandon) the Stripe purchase. A row
-- is created in /api/programme-intake (after the user submits the form on
-- /personal-training and sees their teaser preview) and is finalized in
-- /api/programme-finalize once the user pays via Stripe.

CREATE TABLE IF NOT EXISTS intake_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The intake form payload, stored as JSON for flexibility.
  intake_data JSONB NOT NULL,

  -- The "fake preview" teaser content shown on /programme-preview.
  -- Intentionally NOT the full plan; weeks 2-N are generated only after purchase.
  teaser_content TEXT NOT NULL,

  -- Denormalised fields for fast lookup and admin dashboards.
  client_email TEXT NOT NULL,
  client_name TEXT NOT NULL,
  programme_track TEXT,

  -- Lifecycle timestamps.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Set when /api/programme-finalize successfully verifies a Stripe purchase
  -- and triggers full-plan generation.
  finalized_at TIMESTAMP WITH TIME ZONE,
  stripe_session_id TEXT,

  -- Set if the user's intake fired a red flag (mental health crisis,
  -- eating concerns, RED-S, unresolved injury). When set, no teaser is
  -- generated and no purchase is possible; Emily handles directly.
  red_flag_id TEXT
);

-- Indexes for the most common access patterns.
CREATE INDEX IF NOT EXISTS idx_intake_sessions_created_at
  ON intake_sessions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intake_sessions_client_email
  ON intake_sessions(client_email);

CREATE INDEX IF NOT EXISTS idx_intake_sessions_stripe_session_id
  ON intake_sessions(stripe_session_id);
