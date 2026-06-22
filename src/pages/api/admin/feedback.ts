import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// GET /api/admin/feedback
// Returns every row from plan_week_feedback with the customer's email
// joined in via Supabase Auth. Used by /admin/feedback.

export const GET: APIRoute = async () => {
  try {
    const url = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return json({ error: 'Supabase env not configured.' }, 500);
    }

    const supabase = createClient(url, serviceKey);

    const { data: rows, error } = await supabase
      .from('plan_week_feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return json({ error: `Query failed: ${error.message}` }, 500);
    }

    // Map user_id -> email for display.
    const { data: usersData } = await supabase.auth.admin.listUsers();
    const users = usersData?.users || [];
    const emailByUserId = new Map<string, string>();
    users.forEach((u: any) => {
      if (u.id && u.email) emailByUserId.set(u.id, u.email);
    });

    const feedback = (rows || []).map((r: any) => ({
      ...r,
      customer_email: emailByUserId.get(r.user_id) || 'Unknown',
    }));

    return json({ feedback });
  } catch (err: any) {
    console.error('admin/feedback error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
