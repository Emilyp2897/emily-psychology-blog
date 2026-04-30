-- Migration: Create chat_feedback table
-- This table stores user feedback on Saoirse chatbot responses

CREATE TABLE IF NOT EXISTS chat_feedback (
  id SERIAL PRIMARY KEY,
  feedback_id VARCHAR(80) NOT NULL UNIQUE,
  rating VARCHAR(20) NOT NULL,
  note TEXT,
  question TEXT NOT NULL,
  reply TEXT NOT NULL,
  source_count INTEGER DEFAULT 0,
  used_model BOOLEAN DEFAULT false,
  client VARCHAR(50),
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_chat_feedback_rating ON chat_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_submitted_at ON chat_feedback(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_client ON chat_feedback(client);
