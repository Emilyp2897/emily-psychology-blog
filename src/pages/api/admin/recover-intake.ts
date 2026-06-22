import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { sql } from '../../../lib/db';
import { finalizeIntake } from '../programme-finalize';

export const prerender = false;

// POST /api/admin/recover-intake { intakeId }
//
// Runs finalizeIntake() for an orphaned intake (paid, but no plan
// row). Used by the admin page when a regenerate or initial finalize
// crashed mid-flight and we want to retry plan generation without
// re-charging the customer.
//
// Idempotent: if finalizeIntake's idempotency check trips
// (finalized_at IS NOT NULL on the intake row), it returns
// alreadyFinalized=true and no work is duplicated.

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const intakeId = body?.intakeId;
    if (!intakeId) return json({ error: 'Missing intakeId.' }, 400);

    // Pull the intake to read its stripe_session_id + email + plan_type
    // so we can run a duplicate-recent-plan check before generating.
    const intakeResult = await sql<{
      id: string;
      stripe_session_id: string | null;
      client_email: string | null;
      plan_type: 'physical' | 'mental' | null;
    }>`
      SELECT id, stripe_session_id, client_email, plan_type
      FROM intake_sessions
      WHERE id = ${intakeId}::uuid
      LIMIT 1
    `;
    const intake = intakeResult.rows[0];
    if (!intake) return json({ error: 'Intake not found.' }, 404);
    if (!intake.stripe_session_id) {
      return json({ error: 'Intake has no stripe_session_id.' }, 400);
    }

    // Race guard: if a Plans row was created in the last 2 minutes for
    // this customer + plan_type, another finalize is probably still
    // running (or just finished). Refuse so we don't write a duplicate.
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseServiceKey && intake.client_email && intake.plan_type) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: usersData } = await supabase.auth.admin.listUsers();
      const matched = usersData?.users?.find(
        (u: any) => u.email?.toLowerCase() === intake.client_email?.toLowerCase(),
      );
      if (matched?.id) {
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from('Plans')
          .select('id')
          .eq('user_id', matched.id)
          .eq('plan_type', intake.plan_type)
          .gte('created_at', twoMinAgo)
          .limit(1);
        if (recent && recent.length > 0) {
          return json(
            {
              error:
                'A plan was generated for this customer in the last 2 minutes. Refresh the page to see it. If you want a different plan, delete the existing one first then click Regenerate.',
            },
            409,
          );
        }
      }
    }

    const result = await finalizeIntake({
      token: intake.id,
      sessionId: intake.stripe_session_id,
    });

    if (!result.ok) {
      return json(
        { error: `Re-finalize failed: ${result.error}`, status: result.status },
        result.status,
      );
    }

    return json({
      success: true,
      message: 'Plan generated. Refresh to see it under Pending review.',
      alreadyFinalized: 'alreadyFinalized' in result ? !!result.alreadyFinalized : false,
    });
  } catch (err: any) {
    console.error('recover-intake error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
