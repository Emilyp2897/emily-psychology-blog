# Chat Feedback Database Setup

This guide will help you set up the feedback database for the Saoirse chatbot.

## Prerequisites

- Your site is deployed on Vercel
- You have access to the Vercel dashboard

## Steps

### 1. Create a Vercel Postgres Database (or use existing Neon)

Go to your Vercel project dashboard:
1. Click **Storage** in the top navigation
2. Click **Create Database** → **Postgres** (or **Neon** if available)
3. Follow the prompts to create a new database
4. Copy the connection string when prompted

Vercel will automatically add `POSTGRES_URLDB` (or similar) environment variable to your `.env.local`.

### 2. Run the Migration

Once your database is created:

**Option A: Using Neon Console (Recommended)**
1. Go to your Vercel project → Storage → Neon Database
2. Click **SQL Editor** or open the Neon Console
3. Run each statement separately (Neon doesn't allow multiple statements at once):

**Step 1: Create the table**

Copy and paste this (without the triple backticks) into Neon SQL Editor:

```sql
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
```

Then click **Execute**.

**Step 2: Create index on rating**

```sql
CREATE INDEX IF NOT EXISTS idx_chat_feedback_rating ON chat_feedback(rating);
```

Then click **Execute**.

**Step 3: Create index on submitted_at**

```sql
CREATE INDEX IF NOT EXISTS idx_chat_feedback_submitted_at ON chat_feedback(submitted_at DESC);
```

Then click **Execute**.

**Step 4: Create index on client**

```sql
CREATE INDEX IF NOT EXISTS idx_chat_feedback_client ON chat_feedback(client);
```

Then click **Execute**.

**Option B: Using psql (command line)**
```bash
psql $POSTGRES_URLDB < migrations/001-create-chat-feedback.sql
```

### 3. Verify the Table Was Created

```sql
SELECT * FROM chat_feedback LIMIT 1;
```

### 4. Start Collecting Feedback

Your site is now ready. All feedback submitted via the chat page will be stored in the `chat_feedback` table.

## Querying Your Data

### Recent Feedback (Last 24 Hours)
```sql
SELECT question, rating, note, submitted_at 
FROM chat_feedback 
WHERE submitted_at > NOW() - INTERVAL '24 hours'
ORDER BY submitted_at DESC;
```

### Helpful vs Not Helpful Summary
```sql
SELECT rating, COUNT(*) as count 
FROM chat_feedback 
GROUP BY rating;
```

### Most Asked Questions
```sql
SELECT question, COUNT(*) as count 
FROM chat_feedback 
GROUP BY question 
ORDER BY count DESC 
LIMIT 10;
```

### Questions with Negative Feedback and Notes
```sql
SELECT question, note, submitted_at 
FROM chat_feedback 
WHERE rating = 'not-helpful' AND note != ''
ORDER BY submitted_at DESC;
```

## Environment Variables

Your Vercel Postgres database connection will be available as:
- `POSTGRES_URLDB` (full connection string)
- `POSTGRES_PRISMA_URL` (if using Prisma)
- `POSTGRES_URL_NON_POOLING` (without connection pooling)

These are automatically added to your deployment environment when you create the database.
