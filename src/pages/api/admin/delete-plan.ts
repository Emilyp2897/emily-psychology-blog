import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// POST /api/admin/delete-plan { planId }
//
// Hard-deletes one Plans row. Used by admin to clean up duplicate plans
// produced when a regenerate or recover-intake call raced with another
// finalize. Customer's intake_session is left alone so it can be re-
// finalized later if needed.

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = body?.planId;
    if (!planId) return json({ error: 'Missing planId.' }, 400);

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ error: 'Supabase env vars not configured.' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error } = await supabase
      .from('Plans')
      .delete()
      .eq('id', planId);

    if (error) return json({ error: `Delete failed: ${error.message}` }, 500);

    return json({ success: true });
  } catch (err: any) {
    console.error('delete-plan error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
