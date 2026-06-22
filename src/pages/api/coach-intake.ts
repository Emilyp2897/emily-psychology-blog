import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { generateTeamPlan } from '../../lib/team-plan';
import type { TeamIntake } from '../../lib/team-plan';

export const prerender = false;

// POST /api/coach-intake
//
// PUBLIC endpoint. No coach-account or approval gate — any coach can
// submit a team intake the same way an individual customer submits
// theirs. The generated plan lands in /admin/plans for Emily to review;
// once she approves it, the approve-plan flow emails the coach with
// the share link.
//
// Body (TeamIntake plus coach contact fields):
//   coachName, coachEmail, coachClub?, coachRole?,
//   sport, planType, planDuration, seasonPhase, averageExperienceLevel,
//   groupSize, trainingDays[], matchDays, equipment[], primaryGoal,
//   anythingElse?

function randomShareToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(36)).join('').slice(0, 32);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    const coachName = String(body?.coachName || '').trim();
    const coachEmail = String(body?.coachEmail || '').trim().toLowerCase();
    if (!coachName) return json({ error: 'Your name is required.' }, 400);
    if (!coachEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(coachEmail)) {
      return json({ error: 'A valid email is required.' }, 400);
    }

    const intake: TeamIntake = {
      sport: String(body?.sport || '').trim(),
      planType: body?.planType === 'mental' ? 'mental' : 'physical',
      planDuration: body?.planDuration === '12 weeks' ? '12 weeks' : '6 weeks',
      seasonPhase: ['pre_season', 'championship_leadup', 'in_season', 'off_season'].includes(body?.seasonPhase)
        ? body.seasonPhase
        : '',
      averageExperienceLevel: ['Beginner', 'Intermediate', 'Advanced', 'Mixed'].includes(body?.averageExperienceLevel)
        ? body.averageExperienceLevel
        : 'Mixed',
      groupSize: String(body?.groupSize || '').trim(),
      trainingDays: Array.isArray(body?.trainingDays) ? body.trainingDays.filter((d: any) => typeof d === 'string') : [],
      matchDays: String(body?.matchDays || '').trim(),
      equipment: Array.isArray(body?.equipment) ? body.equipment.filter((d: any) => typeof d === 'string') : [],
      primaryGoal: String(body?.primaryGoal || '').trim(),
      anythingElse: typeof body?.anythingElse === 'string' ? body.anythingElse.trim() || undefined : undefined,
    };

    if (!intake.sport) return json({ error: 'Sport is required.' }, 400);
    if (!intake.groupSize) return json({ error: 'Squad size is required.' }, 400);
    if (!intake.primaryGoal) return json({ error: 'Primary team goal is required.' }, 400);

    const planContent = await generateTeamPlan(intake);

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ error: 'Supabase env not configured.' }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const weeksTotal = intake.planDuration === '12 weeks' ? 12 : 6;
    const shareToken = randomShareToken();

    // Coach contact lives in team_intake_data — admin/approve-plan
    // reads it to know who to email the share link to. user_id is null
    // because the coach has no Supabase account; this is by design.
    const teamIntakeWithCoach = {
      ...intake,
      coachName,
      coachEmail,
      coachClub: String(body?.coachClub || '').trim() || null,
      coachRole: String(body?.coachRole || '').trim() || null,
    };

    const { data: plan, error: insertErr } = await supabase
      .from('Plans')
      .insert({
        user_id: null,
        plan_type: intake.planType,
        weeks_total: weeksTotal,
        plan_content: planContent,
        status: 'pending_review',
        is_team_plan: true,
        share_token: shareToken,
        coach_id: null,
        team_intake_data: teamIntakeWithCoach,
      })
      .select('id, share_token')
      .single();
    if (insertErr) {
      return json({ error: `Plan insert failed: ${insertErr.message}` }, 500);
    }

    // Notify Emily that a new team plan is awaiting review. Best
    // effort — failing the email shouldn't fail the submission.
    const resendApiKey = import.meta.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const fromEmail = import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';
        const safe = (s: string | null | undefined) => (s ? String(s).replace(/[<>]/g, '') : '');
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: 'emilyphelan@mindthegael.co.uk',
            subject: `New team plan for review: ${safe(coachName)}${teamIntakeWithCoach.coachClub ? ' (' + safe(teamIntakeWithCoach.coachClub) + ')' : ''}`,
            html: `
              <p>A new team plan is awaiting review at <a href="https://mindthegael.co.uk/admin/plans">/admin/plans</a>.</p>
              <p><strong>Coach:</strong> ${safe(coachName)} &lt;${safe(coachEmail)}&gt;</p>
              <p><strong>Club:</strong> ${safe(teamIntakeWithCoach.coachClub) || '—'}</p>
              <p><strong>Sport:</strong> ${safe(intake.sport)} &middot; <strong>Squad size:</strong> ${safe(intake.groupSize)}</p>
              <p><strong>Plan:</strong> ${intake.planType} &middot; ${intake.planDuration}</p>
              <p>Once approved, the share link will be emailed to the coach automatically.</p>
            `,
          }),
        });
      } catch (mailErr) {
        console.error('coach-intake notify failed:', mailErr);
      }
    }

    return json({ success: true, planId: plan?.id, shareToken: plan?.share_token });
  } catch (err: any) {
    console.error('coach-intake error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
};

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
