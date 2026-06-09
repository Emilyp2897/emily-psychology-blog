import type { APIRoute } from 'astro';
import { sql } from '../../lib/db';

export const prerender = false;

// GET /api/programme-preview?token={previewToken}
// Returns the teaser content for the given intake session, plus the
// client's first name and email so the preview page can render its
// watermark and personalised greeting.
//
// Does NOT return the intake data itself. The full intake stays
// server-side until /api/programme-finalize is called after purchase.

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) {
    return json({ error: 'Missing token.' }, 400);
  }

  try {
    const result = await sql<{
      teaser_content: string;
      client_name: string;
      client_email: string;
      intake_data: { planDuration?: string };
      finalized_at: string | null;
      red_flag_id: string | null;
      plan_type: 'physical' | 'mental' | null;
    }>`
      SELECT teaser_content, client_name, client_email, intake_data, finalized_at, red_flag_id, plan_type
      FROM intake_sessions
      WHERE id = ${token}::uuid
      LIMIT 1
    `;

    const row = result.rows[0];
    if (!row) {
      return json({ error: 'Preview not found. The link may have expired.' }, 404);
    }

    if (row.red_flag_id) {
      return json({ error: 'This intake was flagged for direct review by Emily. Please check your email.' }, 403);
    }

    if (row.finalized_at) {
      return json({
        error: 'This programme has already been purchased and finalized. Check your email for the full plan.',
      }, 409);
    }

    return json({
      teaserContent: row.teaser_content,
      clientName: row.client_name,
      clientEmail: row.client_email,
      planDuration: row.intake_data?.planDuration || null,
      planType: row.plan_type || 'physical',
    });
  } catch (error: any) {
    console.error('Programme preview fetch error:', error);
    return json({ error: 'Unable to load preview right now. Please try again.' }, 500);
  }
};

function json(payload: any, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
