import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '../../lib/db';
import type { ConsultationWithPlanRequest, ProgramTrackId } from '../../data/types';
import { findSportProfile } from '../../data/sport-profiles';
import { detectRedFlags } from '../../data/red-flags';
import { determineTrack } from '../../data/program-tracks';
import { stripDashes } from '../../lib/email-format';

export const prerender = false;

const EMILY_EMAIL = 'emilyphelan@mindthegael.co.uk';

type ProgrammeIntakeSuccess = {
  success: true;
  previewToken: string;
  teaserContent: string;
};

type ProgrammeIntakeBlocked = {
  success: false;
  reason: 'red_flag';
  message: string;
};

type ProgrammeIntakeError = {
  success: false;
  reason: 'error';
  message: string;
};

type ProgrammeIntakeResponse =
  | ProgrammeIntakeSuccess
  | ProgrammeIntakeBlocked
  | ProgrammeIntakeError;

export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json()) as ConsultationWithPlanRequest;

    if (!body.name || !body.email || !body.sport || !body.goals) {
      return json<ProgrammeIntakeError>(
        { success: false, reason: 'error', message: 'Missing required intake fields.' },
        400
      );
    }

    // Red-flag check first. Crisis cases never generate a teaser, never charge.
    const redFlags = detectRedFlags(body);
    if (redFlags.length > 0) {
      const flagWithMessage = redFlags.find((f) => f.clientMessage);
      const clientMessage =
        flagWithMessage?.clientMessage ||
        'Thank you for sharing this. Emily will reach out personally within 48 hours to talk through your situation before any training plan is put together.';

      // Notify Emily so she can follow up directly.
      await notifyEmilyOfRedFlag(body, redFlags.map((f) => f.id));

      // Log to the database with a marker so Emily can audit later.
      const flaggedPlanType: 'physical' | 'mental' = body.planType === 'mental' ? 'mental' : 'physical';
      await sql`
        INSERT INTO intake_sessions (
          intake_data, teaser_content, client_email, client_name,
          programme_track, red_flag_id, plan_type
        ) VALUES (
          ${JSON.stringify(body)}::jsonb,
          ${'[RED FLAG: no teaser generated]'},
          ${body.email},
          ${body.name},
          ${body.programTrack || null},
          ${redFlags[0].id},
          ${flaggedPlanType}
        )
      `;

      return json<ProgrammeIntakeBlocked>(
        { success: false, reason: 'red_flag', message: clientMessage },
        200
      );
    }

    // Plan type defaults to physical for backwards compatibility.
    const planType: 'physical' | 'mental' = body.planType === 'mental' ? 'mental' : 'physical';

    // Determine the track (only used for physical plans).
    const track = determineTrack(body);

    // Generate the TEASER. This is deliberately NOT the full plan.
    const teaserContent =
      planType === 'mental'
        ? await generateMentalTeaser(body)
        : await generateTeaser(body, track);

    // Persist the intake + teaser in the database, returning the new id.
    const result = await sql<{ id: string }>`
      INSERT INTO intake_sessions (
        intake_data, teaser_content, client_email, client_name, programme_track, plan_type
      ) VALUES (
        ${JSON.stringify(body)}::jsonb,
        ${teaserContent},
        ${body.email},
        ${body.name},
        ${track},
        ${planType}
      )
      RETURNING id
    `;

    const previewToken = result.rows[0]?.id;
    if (!previewToken) {
      throw new Error('Failed to persist intake session.');
    }

    return json<ProgrammeIntakeSuccess>(
      { success: true, previewToken, teaserContent },
      200
    );
  } catch (error: any) {
    console.error('Programme intake error:', error);
    return json<ProgrammeIntakeError>(
      { success: false, reason: 'error', message: getErrorMessage(error) },
      500
    );
  }
};

async function generateTeaser(
  body: ConsultationWithPlanRequest,
  track: ProgramTrackId
): Promise<string> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  // Teasers use Haiku by default: ~3x faster than Sonnet, ~5x cheaper, and
  // the teaser is a short structured output Haiku handles cleanly. The full
  // plan keeps Sonnet. Override via ANTHROPIC_MODEL_TEASER if needed.
  const model =
    import.meta.env.ANTHROPIC_MODEL_TEASER ||
    import.meta.env.ANTHROPIC_MODEL ||
    'claude-haiku-4-5-20251001';

  const sportProfile = findSportProfile(body.sport || '');

  const systemPrompt = [
    'You are generating a TEASER preview of a training programme for the Mind the Gael platform. The athlete has NOT paid yet.',
    '',
    'Your goal: show them the STRUCTURE and FRAMING of their programme without revealing the workable plan.',
    '',
    'STRICT RULES:',
    '- Do NOT include specific exercises, sets, reps, weights, percentages, or RPE prescriptions.',
    '- Do NOT include session-by-session content.',
    '- DO include the weekly themes (e.g. "Week 1: Foundation and movement quality") so they understand the arc.',
    '- DO include a Client Snapshot (2-3 lines about them).',
    '- DO include a Plan Overview (goals, weekly structure at a glance, planned deload week).',
    '- DO include a "What\'s included in the full programme" section listing what they unlock by buying (in bullets).',
    '',
    'VOICE: warm, direct, plain English. Match Emily Phelan\'s voice. No hype. No emojis. No em-dashes or en-dashes (use periods, commas, or parentheses instead). Keep it under 350 words.',
    '',
    'BEGINNER ACCESSIBILITY: if the client is a beginner ("Beginner" or "less than 1 year"), avoid all S&C jargon (RPE, sets, reps, deload, progressive overload, tempo, etc.) or briefly define it when used. Write in second person ("You will..."). Keep sentences short.',
    '',
    'Use exactly these section headers, in this order:',
    '# CLIENT SNAPSHOT',
    '# PLAN OVERVIEW',
    '# WEEKLY THEMES',
    '# WHAT YOU UNLOCK WHEN YOU BUY',
  ].join('\n');

  const userPrompt = [
    `Generate a teaser preview for the following female athlete client. They have requested a ${body.planDuration || '6-week'} programme.`,
    '',
    `Sport: ${sportProfile.name}`,
    `Programme track: ${track}`,
    '',
    'CLIENT INPUT:',
    `- Age: ${body.age ?? 'not provided'}`,
    `- Experience level: ${body.exerciseLevel || 'not provided'}`,
    `- Sports background: ${body.sportsOrNot || 'not provided'}`,
    `- Equipment: ${(body.equipment || []).join(', ') || 'not provided'}`,
    `- Current activity level: ${body.currentActivityLevel || 'not provided'}`,
    `- Sessions per week the schedule allows: ${body.frequencyPerWeek ?? 'not provided'}`,
    `- Plan duration: ${body.planDuration || '6 weeks'}`,
    `- Plan goals: ${(body.planGoals || []).join(', ')}`,
    `- Lifestyle: ${body.lifestyle || 'not provided'}`,
    `- Cycle status: ${body.cycleStatus || 'not provided'}`,
    `- Issues/concerns: ${body.issuesWorries || 'none provided'}`,
    `- Medical: ${body.medicalConditions || 'none'}`,
    `- Injuries: ${body.injuries || 'none'}`,
    `- Companion mental performance plan the client is also doing: ${body.companionPlanSummary || 'not provided. Build the training plan as a standalone.'}`,
    `- Specific goals narrative: ${body.goals}`,
    '',
    'If a companion mental performance plan summary is provided, briefly hint in the teaser that this training plan will be built to reinforce it (e.g. session structure supports applying their mental routines and refocus cues). Do not invent details about the mental plan beyond what the client shared.',
    '',
    'Generate the teaser now. Remember: no specific exercises, sets, reps, weights, RPE, or session content. Just the structure and the value-pitch for buying.',
  ].join('\n');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    temperature: 0.4,
    max_tokens: 550,
    // Cache the teaser system prompt for 5 minutes; subsequent intake
    // submissions within that window pay ~10% of normal input-token cost.
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  // Strip em-dashes the model may have emitted despite the prompt rule.
  return stripDashes(raw);
}

// Mental performance teaser. Parallel to generateTeaser but for the
// psychological side: confidence, focus, pre-performance routines,
// composure under pressure, recovery from mistakes.
async function generateMentalTeaser(
  body: ConsultationWithPlanRequest
): Promise<string> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  // Teasers use Haiku by default: ~3x faster than Sonnet, ~5x cheaper, and
  // the teaser is a short structured output Haiku handles cleanly. The full
  // plan keeps Sonnet. Override via ANTHROPIC_MODEL_TEASER if needed.
  const model =
    import.meta.env.ANTHROPIC_MODEL_TEASER ||
    import.meta.env.ANTHROPIC_MODEL ||
    'claude-haiku-4-5-20251001';

  const systemPrompt = [
    'You are generating a TEASER preview of a Mental Performance Plan for the Mind the Gael platform. The athlete has NOT paid yet.',
    '',
    'Mental Performance Plans focus on the psychological side of sport: confidence, focus, pre-performance routines, managing pressure, recovery from mistakes, and composure in big moments. The full plan draws on the 12-month Gael Performance Toolkit content (Pre-Performance Routines, Self-Talk and Confidence, Mistake Reset, Team Communication, Goal Setting, Imagery and Graded Exposure, Focus and Refocus, Nutrition and Language, Boundaries and Assertiveness, Championship Routines, Values and Balance, Off-Season Recovery).',
    '',
    'Your goal in this TEASER: show them the SHAPE of their mental performance plan without giving away the workable tools.',
    '',
    'STRICT RULES:',
    '- Do NOT teach specific tools, routines, scripts, or techniques.',
    '- Do NOT include session-by-session content.',
    '- DO include weekly themes (e.g. "Week 1: Building your pre-performance routine") so they understand the arc.',
    '- DO include a Client Snapshot (2-3 lines acknowledging what they shared).',
    '- DO include a Plan Overview (what the plan addresses, how it works, expected outcomes).',
    '- DO include a "What you unlock when you buy" section listing what the full plan contains (in bullets).',
    '- Mental performance plans NEVER have exercises, sets, or reps. They are about routines, attentional skills, self-talk, breathing patterns, reset cues, and mindset frames.',
    '',
    'VOICE: warm, direct, plain English. Match Emily Phelan\'s voice. No hype. No emojis. No em-dashes or en-dashes (use periods, commas, or parentheses instead). Keep it under 350 words.',
    '',
    'Use exactly these section headers, in this order:',
    '# CLIENT SNAPSHOT',
    '# PLAN OVERVIEW',
    '# WEEKLY THEMES',
    '# WHAT YOU UNLOCK WHEN YOU BUY',
  ].join('\n');

  const userPrompt = [
    `Generate a Mental Performance Plan teaser for the following female athlete. They have requested a ${body.planDuration || '6-week'} plan.`,
    '',
    'CLIENT INPUT:',
    `- Sport: ${body.sport || 'not provided'}`,
    `- Level of competition: ${body.competitionLevel || 'not provided'}`,
    `- Years competing: ${body.yearsCompeting || 'not provided'}`,
    `- Plan duration: ${body.planDuration || '6 weeks'}`,
    `- Performance moments they want to work on: ${(body.performanceMomentsToWorkOn || []).join(', ') || 'not provided'}`,
    `- Current pre-performance routines: ${body.currentRoutines || 'not provided'}`,
    `- A peak moment they remember: ${body.peakMoment || 'not provided'}`,
    `- A struggle moment that stuck with them: ${body.struggleMoment || 'not provided'}`,
    `- Current confidence level (1-10): ${body.confidenceLevel || 'not provided'}`,
    `- Companion physical training plan the client is also doing: ${body.companionPlanSummary || 'not provided. Build the mental plan as a standalone.'}`,
    `- Anything else: ${body.anythingElse || 'not provided'}`,
    `- Goals narrative: ${body.goals}`,
    '',
    'If a companion physical training plan summary is provided, briefly hint in the teaser that this mental plan will be built to apply to their training and match moments. Do not invent details about the physical plan beyond what the client shared.',
    '',
    'Generate the teaser now. Remember: no specific tools, routines, or scripts. Just the structure and the value-pitch for buying.',
  ].join('\n');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    temperature: 0.4,
    max_tokens: 550,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return stripDashes(raw);
}

async function notifyEmilyOfRedFlag(
  body: ConsultationWithPlanRequest,
  flagIds: string[]
): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('Cannot notify Emily of red flag: RESEND_API_KEY missing.');
    return;
  }
  const fromEmail =
    import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';

  const isCrisis = flagIds.includes('mental_health_crisis');
  const subject = isCrisis
    ? `[CRISIS FLAG] Intake from ${body.name}`
    : `[CLINICAL PAUSE] Intake from ${body.name}`;

  const text = [
    isCrisis ? '*** MENTAL HEALTH CRISIS FLAGGED ***' : '*** CLINICAL PAUSE FLAGGED ***',
    `Flag(s): ${flagIds.join(', ')}`,
    '',
    'NO teaser was generated and NO purchase was offered. The client was shown a support message and routed to you.',
    '',
    `Name: ${body.name}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone || 'Not provided'}`,
    `Sport: ${body.sport}`,
    '',
    'CLIENT INPUT (relevant fields):',
    `- Issues/worries: ${body.issuesWorries || 'not provided'}`,
    `- Medical: ${body.medicalConditions || 'not provided'}`,
    `- Injuries: ${body.injuries || 'not provided'}`,
    `- Anything else: ${body.anythingElse || 'not provided'}`,
    `- Goals: ${body.goals}`,
    '',
    'Please follow up with this client directly within 48 hours.',
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [EMILY_EMAIL],
      subject,
      text,
      reply_to: body.email,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'No response body');
    console.error(`Failed to notify Emily of red flag: ${response.status} ${details}`);
  }
}

function json<T>(payload: T, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getErrorMessage(error: any): string {
  if (error?.message?.includes('ANTHROPIC_API_KEY')) {
    return 'AI service is not configured yet. Please add ANTHROPIC_API_KEY in environment variables.';
  }
  if (error?.message?.toLowerCase?.().includes('rate limit')) {
    return 'AI rate limit reached. Please try again shortly.';
  }
  if (error?.message?.toLowerCase?.().includes('connect') || error?.message?.toLowerCase?.().includes('database')) {
    return 'Database connection failed. Please contact Emily directly at emilyphelan@mindthegael.co.uk.';
  }
  return 'We could not process your intake right now. Please try again in a moment, or email Emily at emilyphelan@mindthegael.co.uk.';
}
