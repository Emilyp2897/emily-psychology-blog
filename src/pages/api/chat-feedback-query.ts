export const prerender = false;

import { sql } from '@vercel/postgres';

export const GET = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'recent';
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '50'), 500);

  try {
    let result;

    if (action === 'recent') {
      result = await sql`
        SELECT id, feedback_id, rating, note, question, submitted_at
        FROM chat_feedback
        ORDER BY submitted_at DESC
        LIMIT ${limit}
      `;
    } else if (action === 'summary') {
      result = await sql`
        SELECT 
          rating, 
          COUNT(*) as count
        FROM chat_feedback
        GROUP BY rating
      `;
    } else if (action === 'top-questions') {
      result = await sql`
        SELECT 
          question, 
          COUNT(*) as count,
          SUM(CASE WHEN rating = 'helpful' THEN 1 ELSE 0 END) as helpful_count,
          SUM(CASE WHEN rating = 'not-helpful' THEN 1 ELSE 0 END) as not_helpful_count
        FROM chat_feedback
        GROUP BY question
        ORDER BY count DESC
        LIMIT ${Math.min(limit, 50)}
      `;
    } else if (action === 'negative-feedback') {
      result = await sql`
        SELECT 
          id, 
          question, 
          note, 
          submitted_at
        FROM chat_feedback
        WHERE rating = 'not-helpful' AND note != ''
        ORDER BY submitted_at DESC
        LIMIT ${limit}
      `;
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action. Use: recent, summary, top-questions, negative-feedback' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result.rows), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Chat feedback query error:', error);
    return new Response(
      JSON.stringify({ error: 'Database error. Table may not exist yet. See CHAT_FEEDBACK_SETUP.md' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
