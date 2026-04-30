import { sql } from '@vercel/postgres';

export const prerender = false;

function getClientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return `ip:${ip}`;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return `ip:${realIp.trim()}`;

  return 'ip:unknown';
}

export const POST = async ({ request }: { request: Request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const page = typeof body?.page === 'string' ? body.page.slice(0, 260) : '';
    const feedbackType = typeof body?.feedbackType === 'string' ? body.feedbackType.slice(0, 40) : '';
    const message = typeof body?.message === 'string' ? body.message.slice(0, 1500) : '';
    const email = typeof body?.email === 'string' ? body.email.slice(0, 320) : '';
    const client = getClientKey(request);

    if (!feedbackType || !message) {
      return new Response(JSON.stringify({ error: 'Feedback type and message are required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await sql`
      CREATE TABLE IF NOT EXISTS content_feedback (
        id SERIAL PRIMARY KEY,
        page TEXT,
        feedback_type VARCHAR(40) NOT NULL,
        message TEXT NOT NULL,
        email TEXT,
        client TEXT,
        submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      INSERT INTO content_feedback (page, feedback_type, message, email, client)
      VALUES (${page}, ${feedbackType}, ${message}, ${email}, ${client})
    `;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Content feedback error:', error);
    return new Response(JSON.stringify({ error: 'Unable to submit feedback right now.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};