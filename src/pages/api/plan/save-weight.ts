import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// POST /api/plan/save-weight { planId, week, session, exercise, weight }
//
// Stores the customer's chosen weight for one exercise on one session.
// Persists in Plans.weights JSONB under the key "<week>.<session>.<exercise>".
// Setting weight to "" or null removes the entry.
//
// Auth: customer's Supabase access token in `Authorization: Bearer ...`.

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
    const exercise = Number(body?.exercise);
    const weight = body?.weight === undefined || body?.weight === null
      ? ''
      : String(body.weight).trim();

    if (!planId || !Number.isFinite(week) || !Number.isFinite(session) || !Number.isFinite(exercise)) {
      return json({ error: 'Missing planId / week / session / exercise.' }, 400);
    }

    const supabase = createClient(url, serviceKey);

    const { data: plan, error: planErr } = await supabase
      .from('Plans')
      .select('user_id, weights')
      .eq('id', planId)
      .single();
    if (planErr || !plan) {
      return json({ error: `Plan not found: ${planErr?.message || 'no row'}` }, 404);
    }
    if (plan.user_id !== userId) {
      return json({ error: 'You do not own this plan.' }, 403);
    }

    const weights =
      plan.weights && typeof plan.weights === 'object' ? { ...plan.weights } : {};
    const key = `${week}.${session}.${exercise}`;
    if (weight) weights[key] = weight;
    else delete weights[key];

    const { error: updateErr } = await supabase
      .from('Plans')
      .update({ weights })
      .eq('id', planId);
    if (updateErr) {
      return json({ error: `Update failed: ${updateErr.message}` }, 500);
    }

    return json({ success: true, weights });
  } catch (err: any) {
    console.error('save-weight error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
