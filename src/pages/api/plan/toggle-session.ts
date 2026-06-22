import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// POST /api/plan/toggle-session { planId, week, session, exercise, completed }
//
// Toggles one item's completion state on a customer's plan. Stores
// the completion timestamp in the Plans.progress JSONB column under
// the key "<week>.<session>.<exercise>" (e.g. "1.2.3" = week 1,
// session 2, exercise 3). If `exercise` is omitted, falls back to
// the older 2-part key "<week>.<session>" for backwards compatibility.
//
// Auth: requires the customer's Supabase access token in
// `Authorization: Bearer <token>`. Server verifies the token resolves
// to the same user_id that owns the plan.

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) return json({ error: 'No auth token.' }, 401);

    const url = import.meta.env.PUBLIC_SUPABASE_URL;
    const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      return json({ error: 'Supabase env not configured on server.' }, 500);
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
    const week = Number(body?.week);
    const session = Number(body?.session);
    const exerciseRaw = body?.exercise;
    const exercise = exerciseRaw === undefined || exerciseRaw === null ? null : Number(exerciseRaw);
    const completed = !!body?.completed;

    if (!planId || !Number.isFinite(week) || !Number.isFinite(session)) {
      return json({ error: 'Missing planId / week / session.' }, 400);
    }
    if (exercise !== null && !Number.isFinite(exercise)) {
      return json({ error: 'exercise must be a number if provided.' }, 400);
    }

    const supabase = createClient(url, serviceKey);

    // Fetch the plan so we can (a) verify ownership and (b) merge the
    // new completion state into the existing progress JSONB.
    const { data: plan, error: planErr } = await supabase
      .from('Plans')
      .select('user_id, progress')
      .eq('id', planId)
      .single();
    if (planErr || !plan) {
      return json({ error: `Plan not found: ${planErr?.message || 'no row'}` }, 404);
    }
    if (plan.user_id !== userId) {
      return json({ error: 'You do not own this plan.' }, 403);
    }

    const progress =
      plan.progress && typeof plan.progress === 'object' ? { ...plan.progress } : {};

    const key = exercise !== null ? `${week}.${session}.${exercise}` : `${week}.${session}`;
    if (completed) {
      progress[key] = new Date().toISOString();
    } else {
      delete progress[key];
    }

    const { error: updateErr } = await supabase
      .from('Plans')
      .update({ progress })
      .eq('id', planId);
    if (updateErr) {
      return json({ error: `Update failed: ${updateErr.message}` }, 500);
    }

    return json({ success: true, progress });
  } catch (err: any) {
    console.error('toggle-session error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
