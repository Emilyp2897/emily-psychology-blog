import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// GET /api/customer-plans
// Auth: customer's Supabase access token in `Authorization: Bearer ...`.
//
// Returns the merged list of plans the signed-in user is connected to:
//   - Individual plans where Plans.user_id = their auth user id
//   - Team plans where Plans.team_intake_data->>coachEmail = their email
//
// Server-side because team plans live with user_id = null (no auth on
// coach intake) — RLS policies keyed on auth.uid() would never return
// them to the customer-facing supabase client. This endpoint verifies
// the token, then uses the service-role key to do an RLS-bypassing
// query that joins both ownership paths.

export const GET: APIRoute = async ({ request }) => {
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
    const userEmail = (userData.user.email || '').toLowerCase();

    const supabase = createClient(url, serviceKey);

    // Individual plans: only return ones Emily has approved.
    // Pending-review plans live in the admin queue, not the customer's
    // dashboard. Customers shouldn't see drafts of their own plans.
    const { data: individualPlans, error: indErr } = await supabase
      .from('Plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (indErr) {
      return json({ error: `Individual plans query failed: ${indErr.message}` }, 500);
    }

    let teamPlans: any[] = [];
    if (userEmail) {
      const { data: tp, error: teamErr } = await supabase
        .from('Plans')
        .select('*')
        .eq('is_team_plan', true)
        .ilike('team_intake_data->>coachEmail', userEmail)
        .order('created_at', { ascending: false });
      if (teamErr) {
        return json({ error: `Team plans query failed: ${teamErr.message}` }, 500);
      }
      teamPlans = Array.isArray(tp) ? tp : [];
    }

    const allPlans = [...(individualPlans || []), ...teamPlans].sort((a: any, b: any) => {
      return (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0);
    });

    return json({ plans: allPlans });
  } catch (err: any) {
    console.error('customer-plans error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
