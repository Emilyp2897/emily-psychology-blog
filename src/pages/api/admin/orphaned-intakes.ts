import type { APIRoute } from 'astro';
import { sql } from '../../../lib/db';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// GET /api/admin/orphaned-intakes
//
// Returns intake_sessions that are "paid but no plan":
//   - stripe_session_id IS NOT NULL  (customer paid)
//   - finalized_at IS NULL           (no plan written)
//   - red_flag_id IS NULL            (not blocked by safety rules)
//
// Used by the admin page to surface intakes whose plan generation
// crashed mid-flight (e.g. a regenerate that was interrupted), so they
// can be re-finalized with one click.

export const GET: APIRoute = async () => {
  try {
    // Pull the candidate intakes from Postgres.
    const result = await sql<{
      id: string;
      client_email: string | null;
      client_name: string | null;
      plan_type: 'physical' | 'mental' | null;
      stripe_session_id: string | null;
      created_at: string | null;
    }>`
      SELECT id, client_email, client_name, plan_type, stripe_session_id, created_at
      FROM intake_sessions
      WHERE stripe_session_id IS NOT NULL
        AND finalized_at IS NULL
        AND red_flag_id IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `;

    // Cross-check against Supabase Plans to exclude intakes that DO
    // have a plan written (rare, but possible if finalized_at was reset
    // and a plan still exists from before).
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    let intakesWithoutPlans = result.rows;

    if (supabaseUrl && supabaseServiceKey && intakesWithoutPlans.length > 0) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: plans } = await supabase
        .from('Plans')
        .select('user_id, plan_type, customer_email');

      // Match a plan to an intake by (email, plan_type). If a plan row
      // already exists with the same email+plan_type, treat the intake
      // as already-served and hide it from the orphan list.
      const planKey = new Set<string>(
        (plans || []).map((p: any) => `${(p.customer_email || '').toLowerCase()}|${p.plan_type}`),
      );

      // Plans rows store user_id not email, so we also need to map user_id -> email
      // via auth.admin.listUsers to be thorough. Keep it simple here and just rely on
      // customer_email if it was stored; otherwise fall through (we still SHOW the
      // intake — Emily can decide).
      intakesWithoutPlans = result.rows.filter(r => {
        const key = `${(r.client_email || '').toLowerCase()}|${r.plan_type}`;
        return !planKey.has(key);
      });
    }

    return json({ intakes: intakesWithoutPlans });
  } catch (err: any) {
    console.error('orphaned-intakes error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
