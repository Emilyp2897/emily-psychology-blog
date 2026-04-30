export const prerender = false;

import { sql } from '@vercel/postgres';

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

function maskClient(clientKey: string): string {
  return clientKey.replace(/ip:/, '').replace(/\d+$/g, 'x');
}

export const POST = async ({ request }: { request: Request }) => {
  const clientKey = getClientKey(request);

  try {
    const body = await request.json().catch(() => ({}));

    const feedbackId = typeof body?.feedbackId === 'string' ? body.feedbackId.slice(0, 80) : '';
    const rating = body?.rating === 'helpful' || body?.rating === 'not-helpful' ? body.rating : '';
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';
    const question = typeof body?.question === 'string' ? body.question.slice(0, 1200) : '';
    const reply = typeof body?.reply === 'string' ? body.reply.slice(0, 1600) : '';
    const sourceCount = Number.isFinite(body?.sourceCount) ? Number(body.sourceCount) : 0;
    const usedModel = Boolean(body?.usedModel);

    if (!feedbackId || !rating || !question) {
      return new Response(JSON.stringify({ error: 'Invalid feedback payload.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const maskedClient = maskClient(clientKey);
    const submittedAt = new Date().toISOString();

    try {
      await sql`
        INSERT INTO chat_feedback (feedback_id, rating, note, question, reply, source_count, used_model, client, submitted_at)
        VALUES (${feedbackId}, ${rating}, ${note}, ${question}, ${reply}, ${sourceCount}, ${usedModel}, ${maskedClient}, ${submittedAt})
      `;
    } catch (dbError: any) {
      if (dbError?.code !== 'ENOTFOUND') {
        console.error('Database insert error (possibly table does not exist):', dbError);
      }
    }

    console.info('[chat-feedback]', {
      at: submittedAt,
      client: maskedClient,
      feedbackId,
      rating,
      note,
      question,
      reply,
      sourceCount,
      usedModel,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Chat feedback API error:', error);
    return new Response(JSON.stringify({ error: 'Unable to save feedback.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
