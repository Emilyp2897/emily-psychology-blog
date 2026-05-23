export const prerender = false;

import { sql } from '@vercel/postgres';

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const FEEDBACK_TO_EMAIL = import.meta.env.CHAT_FEEDBACK_TO_EMAIL;
const FEEDBACK_FROM_EMAIL = import.meta.env.CHAT_FEEDBACK_FROM_EMAIL || 'onboarding@resend.dev';

async function sendFeedbackEmail(input: {
  feedbackId: string;
  rating: string;
  note: string;
  question: string;
  reply: string;
  sourceCount: number;
  usedModel: boolean;
  client: string;
  submittedAt: string;
}) {
  if (!RESEND_API_KEY || !FEEDBACK_TO_EMAIL) return;

  const text = [
    'New chatbot feedback received',
    `Feedback ID: ${input.feedbackId}`,
    `Rating: ${input.rating}`,
    `Submitted: ${input.submittedAt}`,
    `Client: ${input.client}`,
    `Used model: ${input.usedModel}`,
    `Source count: ${input.sourceCount}`,
    '',
    'Question:',
    input.question || '(none)',
    '',
    'Reply:',
    input.reply || '(none)',
    '',
    'Note:',
    input.note || '(none)',
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FEEDBACK_FROM_EMAIL,
      to: [FEEDBACK_TO_EMAIL],
      subject: `Chat feedback: ${input.rating}`,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}

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

    await sql`
      INSERT INTO chat_feedback (feedback_id, rating, note, question, reply, source_count, used_model, client, submitted_at)
      VALUES (${feedbackId}, ${rating}, ${note}, ${question}, ${reply}, ${sourceCount}, ${usedModel}, ${maskedClient}, ${submittedAt})
    `;

    // Send email, but do not fail the API if email sending fails
    sendFeedbackEmail({
      feedbackId,
      rating,
      note,
      question,
      reply,
      sourceCount,
      usedModel,
      client: maskedClient,
      submittedAt,
    }).catch((error) => {
      console.error('Chat feedback email error:', error);
    });

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
