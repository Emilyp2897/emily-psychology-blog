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

**Option A: Using psql (command line)**
```bash
psql $POSTGRES_URLDB < migrations/001-create-chat-feedback.sql
```

**Option B: Using Vercel Data UI**
1. Go to your Vercel project → Storage → Your Postgres database
2. Click the **Queries** tab
3. Copy and paste the SQL from `migrations/001-create-chat-feedback.sql`
4. Click **Execute**

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
