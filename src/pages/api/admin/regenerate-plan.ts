import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { sql } from '../../../lib/db';
import { finalizeIntake } from '../programme-finalize';

export const prerender = false;

// POST /api/admin/regenerate-plan { planId }
//
// Used when an existing plan in the Supabase Plans table is incomplete
// (e.g. it was truncated because the model hit max_tokens before
// finishing the last weeks). This endpoint:
//
//   1. Looks up the Plans row to get the user_id.
//   2. Looks up the user's email in Supabase Auth.
//   3. Finds the most recent finalized intake_session in Postgres for
//      that email and plan_type.
//   4. Deletes the old (incomplete) Plans row from Supabase.
//   5. Resets finalized_at on the intake_session.
//   6. Calls finalizeIntake() with the intake token + Stripe session,
//      which re-runs the model with the current (higher) token cap and
//      writes a fresh Plans row.
//
// Idempotent in the sense that running it twice produces the same end
// state (one fresh Plans row), assuming the model behaves consistently.

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

    // 1. Look up the plan we're regenerating.
    const { data: plan, error: planErr } = await supabase
      .from('Plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (planErr || !plan) {
      return json({ error: `Plan not found: ${planErr?.message || 'no row'}` }, 404);
    }

    // 2. Get the user's email.
    const { data: usersData } = await supabase.auth.admin.listUsers();
    const matchedUser = usersData?.users?.find((u: any) => u.id === plan.user_id);
    if (!matchedUser?.email) {
      return json({ error: 'Could not find user email for this plan.' }, 404);
    }
    const userEmail = matchedUser.email;

    // Race guard: if a DIFFERENT Plans row was created for this user +
    // plan_type in the last 2 minutes (i.e. another regenerate finished
    // very recently), bail. Stops parallel regenerate clicks producing
    // duplicate Plans rows.
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentOther } = await supabase
      .from('Plans')
      .select('id')
      .eq('user_id', plan.user_id)
      .eq('plan_type', plan.plan_type)
      .neq('id', planId)
      .gte('created_at', twoMinAgo)
      .limit(1);
    if (recentOther && recentOther.length > 0) {
      return json(
        {
          error:
            'Another regenerate for this customer finished in the last 2 minutes. Refresh the page to see the newer plan. Delete the unwanted one before regenerating again.',
        },
        409,
      );
    }

    // 3. Find the matching finalized intake_session for this email +
    //    plan_type. Use the most recent one so we re-finalize the plan
    //    that produced this Plans row, not an older intake.
    const intakeResult = await sql<{
      id: string;
      stripe_session_id: string | null;
      finalized_at: string | null;
    }>`
      SELECT id, stripe_session_id, finalized_at
      FROM intake_sessions
      WHERE client_email = ${userEmail}
        AND plan_type = ${plan.plan_type}
        AND finalized_at IS NOT NULL
      ORDER BY finalized_at DESC
      LIMIT 1
    `;

    const intake = intakeResult.rows[0];
    if (!intake) {
      return json(
        {
          error: `Could not find a finalized intake for ${userEmail} of type ${plan.plan_type}.`,
        },
        404,
      );
    }
    if (!intake.stripe_session_id) {
      return json({ error: 'Matching intake has no stripe_session_id.' }, 400);
    }

    // 4. Delete the old plan row.
    const { error: deleteErr } = await supabase
      .from('Plans')
      .delete()
      .eq('id', planId);
    if (deleteErr) {
      return json({ error: `Failed to delete old plan: ${deleteErr.message}` }, 500);
    }

    // 5. Reset finalized_at so finalizeIntake doesn't short-circuit on
    //    its idempotency check.
    await sql`
      UPDATE intake_sessions
      SET finalized_at = NULL
      WHERE id = ${intake.id}::uuid
    `;

    // 6. Re-run the full finalize flow. This regenerates the plan with
    //    the current token cap and writes a fresh Plans row.
    const result = await finalizeIntake({
      token: intake.id,
      sessionId: intake.stripe_session_id,
    });

    if (!result.ok) {
      return json(
        {
          error: `Re-finalize failed: ${result.error}`,
          status: result.status,
        },
        result.status,
      );
    }

    return json({
      success: true,
      message: 'Plan regenerated. Refresh the admin page to see the new version.',
    });
  } catch (err: any) {
    console.error('regenerate-plan error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
