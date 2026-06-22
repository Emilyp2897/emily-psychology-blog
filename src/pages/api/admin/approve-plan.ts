import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const ADMIN_EMAIL = 'emilyphelan@mindthegael.co.uk';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { planId } = body;

    if (!planId) {
      return json({ error: 'Missing planId.' }, 400);
    }

    const supabase = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL,
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error } = await supabase
      .from('Plans')
      .update({
        status: 'active',
        approved_at: new Date().toISOString(),
      })
      .eq('id', planId);

    if (error) {
      return json({ error: error.message }, 500);
    }

    const { data: plan } = await supabase
      .from('Plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (plan) {
      const { data: usersData } = await supabase.auth.admin.listUsers();
      const user = usersData?.users?.find((u: any) => u.id === plan.user_id);

      if (user?.email) {
        const resendApiKey = import.meta.env.RESEND_API_KEY;
        const fromEmail = import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';
        const firstName = (user.user_metadata?.full_name || user.email).split(' ')[0];
        const planLabel = plan.plan_type === 'mental' ? 'mental performance plan' : 'training plan';
        const duration = `${plan.weeks_total}-week`;

        if (resendApiKey) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [user.email],
              subject: `Your ${duration} ${planLabel} is ready`,
              reply_to: ADMIN_EMAIL,
              html: `
                <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #1a2e1f; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="text-align: center; margin-bottom: 20px;">
                    <img src="https://mindthegael.co.uk/assets/MTG_colour.png" alt="Mind the Gael" style="max-width: 180px; height: auto;" />
                  </div>
                  <p>Hi ${firstName},</p>
                  <p>Your <strong>${duration} ${planLabel}</strong> has been reviewed and is now live in your dashboard.</p>
                  <p>Your plan unlocks week by week from today. Week 1 is ready to go now.</p>
                  <div style="text-align: center; margin: 2rem 0;">
                    <a href="https://mindthegael.co.uk/dashboard" style="display: inline-block; padding: 0.75rem 1.75rem; background: #c0fe71; color: #1a2e1f; font-weight: 700; border-radius: 8px; text-decoration: none;">Go to my dashboard</a>
                  </div>
                  <p>If you have any questions, reply to this email or reach me at ${ADMIN_EMAIL}.</p>
                  <p style="margin-top: 30px; color: #69005a; font-style: italic;">
                    Emily Phelan<br/>
                    Mind the Gael<br/>
                    <a href="https://mindthegael.co.uk" style="color: #69005a;">mindthegael.co.uk</a>
                  </p>
                </div>
              `,
            }),
          });
        }
      }
    }

    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
