import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// POST /api/plan/week-feedback
// Body: { planId, weekNumber, rating, workedWell?, wasHard?, notesForEmily? }
//
// Stores one customer's feedback on a single completed week of their
// plan. Used by the pilot feedback popup that appears after the week-
// complete celebration on /plan/[id].
//
// Auth: customer's Supabase access token in `Authorization: Bearer ...`.
// The token must resolve to the same user_id that owns the plan.

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) return json({ error: 'No auth token.' }, 401);

    const url = import.meta.env.PUBLIC_SUPABASE_URL;
    const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      return json({ error: 'Supabase env not configured.' }, 500);
    }

    // Verify the user via their access token.
    const supabaseAuth = createClient(url, anonKey);
    const { data: userData, error: userErr } =
      await supabaseAuth.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid auth token.' }, 401);
    }
    const userId = userData.user.id;

    const body = await request.json().catch(() => ({}));
    const planId = body?.planId;
    const weekNumber = Number(body?.weekNumber);
    const ratingRaw = body?.rating;
    const rating =
      ratingRaw === undefined || ratingRaw === null ? null : Number(ratingRaw);
    const workedWell = typeof body?.workedWell === 'string' ? body.workedWell.trim() : null;
    const wasHard = typeof body?.wasHard === 'string' ? body.wasHard.trim() : null;
    const notesForEmily = typeof body?.notesForEmily === 'string' ? body.notesForEmily.trim() : null;

    if (!planId || !Number.isFinite(weekNumber)) {
      return json({ error: 'Missing planId or weekNumber.' }, 400);
    }
    if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
      return json({ error: 'rating must be 1-5 if provided.' }, 400);
    }
    if (rating === null && !workedWell && !wasHard && !notesForEmily) {
      return json({ error: 'Need at least a rating or some text feedback.' }, 400);
    }

    const supabase = createClient(url, serviceKey);

    // Verify ownership.
    const { data: plan, error: planErr } = await supabase
      .from('Plans')
      .select('user_id')
      .eq('id', planId)
      .single();
    if (planErr || !plan) {
      return json({ error: 'Plan not found.' }, 404);
    }
    if (plan.user_id !== userId) {
      return json({ error: 'You do not own this plan.' }, 403);
    }

    const { error: insertErr } = await supabase
      .from('plan_week_feedback')
      .insert({
        plan_id: planId,
        user_id: userId,
        week_number: weekNumber,
        rating,
        worked_well: workedWell || null,
        was_hard: wasHard || null,
        notes_for_emily: notesForEmily || null,
      });
    if (insertErr) {
      return json({ error: `Insert failed: ${insertErr.message}` }, 500);
    }

    return json({ success: true });
  } catch (err: any) {
    console.error('week-feedback error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
