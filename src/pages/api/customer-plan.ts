import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// GET /api/customer-plan?id=<plan id>
// Auth: customer's Supabase access token in `Authorization: Bearer ...`.
//
// Returns a single plan the signed-in user owns.
//
// This exists for the same reason as /api/customer-plans: the dashboard
// list is built server-side with the service-role key because RLS policies
// keyed on auth.uid() do not return these rows to the browser client. The
// plan detail page used to query Supabase directly from the browser with
// the anon key, so a plan could appear on the dashboard and then fail to
// load when opened. Both now read through the same service-role path.
//
// Ownership is enforced here rather than by RLS:
//   - individual plans must match the caller's user id, and be active
//   - team plans must carry the caller's email as the coach

export const GET: APIRoute = async ({ request, url: requestUrl }) => {
  try {
    const planId = requestUrl.searchParams.get('id');
    if (!planId) return json({ error: 'No plan id.' }, 400);

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
    const userEmail = (userData.user.email || '').toLowerCase();

    const supabase = createClient(url, serviceKey);

    const { data: plan, error } = await supabase
      .from('Plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle();

    if (error) return json({ error: `Plan query failed: ${error.message}` }, 500);
    if (!plan) return json({ error: 'Plan not found.' }, 404);

    const ownsIndividual = plan.user_id === userId && plan.status === 'active';
    const coachEmail = (plan.team_intake_data?.coachEmail || '').toLowerCase();
    const ownsTeam = plan.is_team_plan === true && !!userEmail && coachEmail === userEmail;

    if (!ownsIndividual && !ownsTeam) {
      // Deliberately the same shape as "not found" so this cannot be used
      // to probe which plan ids exist.
      return json({ error: 'Plan not found.' }, 404);
    }

    return json({ plan });
  } catch (err: any) {
    console.error('customer-plan error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
