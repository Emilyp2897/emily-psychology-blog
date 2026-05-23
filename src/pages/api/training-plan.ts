import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ConsultationWithPlanRequest,
  ProgramTrackId,
  RedFlag,
  RoutingDecision,
  SportProfile,
  Exercise,
} from '../../data/types';
import { findSportProfile } from '../../data/sport-profiles';
import {
  filterExercises,
  expandEquipmentTags,
  normaliseLevel,
  detectAvoidIfTags,
} from '../../data/exercises';
import { detectRedFlags } from '../../data/red-flags';
import {
  determineTrack,
  getTrackProtocol,
  getTrackCitations,
} from '../../data/program-tracks';
import { decideRouting } from '../../lib/plan-routing';
import { EMILY_CALENDAR_BOOKING_URL } from '../../consts';

export const prerender = false;

const EMILY_EMAIL = 'emilyphelan@mindthegael.co.uk';

export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json()) as ConsultationWithPlanRequest;

    if (!body.name || !body.email || !body.sport || !body.goals) {
      return jsonError('Missing required consultation fields', 400);
    }

    // 1. Detect any pause-for-clinical-review red flags first.
    const redFlags = detectRedFlags(body);

    // 2. Determine program track (standard / pregnancy / postpartum / endo / RTP).
    const track = determineTrack(body);

    // 3. Routing decision — where this goes, whether a plan is generated.
    const routing = decideRouting({ redFlags, track });

    // 4. Build context for the model (sport profile, exercise pool).
    const sportProfile = findSportProfile(body.sport || '');
    const level = normaliseLevel(body.exerciseLevel);
    const equipmentTags = expandEquipmentTags(body.equipment);
    const avoidIfTags = detectAvoidIfTags({
      injuries: body.injuries,
      medicalConditions: body.medicalConditions,
      issuesWorries: body.issuesWorries,
      cycleStatus: body.cycleStatus,
      programTrack: body.programTrack,
    });
    const exercisePool = filterExercises({
      equipment: equipmentTags,
      level,
      avoidIfTags,
    });

    // 5. Generate the plan, if routing allows.
    let generatedPlan = '';
    if (
      routing.shouldGeneratePlan &&
      body.includeProgressionPlan &&
      body.age &&
      body.frequencyPerWeek &&
      body.planGoals?.length
    ) {
      const prompt = buildPlanPrompt({
        body,
        track,
        sportProfile,
        exercisePool,
        avoidIfTags,
      });
      generatedPlan = await generatePlanWithAnthropic(prompt, track);
    }

    // 6. Notify Emily (always — in both v1 and v2).
    await sendEmilyNotificationEmail({
      body,
      generatedPlan,
      routing,
      redFlags,
      track,
      sportProfile,
    });

    // 7. If routing is direct to client (v2 standard case only), also send to client.
    if (routing.destination === 'client' && generatedPlan) {
      await sendClientPlanEmail({ body, generatedPlan, sportProfile });
    }

    // 8. Log the event.
    console.log('[CONSULTATION_REQUEST]', {
      name: body.name,
      email: body.email,
      timestamp: new Date().toISOString(),
      redFlagCount: redFlags.length,
      redFlagIds: redFlags.map((f) => f.id),
      track,
      routing: routing.destination,
      shouldGeneratePlan: routing.shouldGeneratePlan,
      hasGeneratedPlan: !!generatedPlan,
    });

    // 9. Return the appropriate client-facing response.
    return jsonResponse(buildClientResponse(routing, redFlags));
  } catch (error: any) {
    console.error('Consultation submission error:', error);
    return jsonError(getErrorMessage(error), 500);
  }
};

// ─── Plan generation ────────────────────────────────────────────────

async function generatePlanWithAnthropic(prompt: string, track: ProgramTrackId): Promise<string> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  const model =
    import.meta.env.ANTHROPIC_MODEL_PLAN ||
    import.meta.env.ANTHROPIC_MODEL ||
    'claude-sonnet-4-5';

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: track === 'standard' ? 2400 : 2800,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function buildSystemPrompt(): string {
  return [
    'You are the strength and conditioning planning assistant for Mind the Gael, an online platform run by Emily Phelan that focuses on women\'s health and performance for female athletes.',
    '',
    'You generate draft training plans. Some plans are reviewed by Emily before going to the client; some go directly to the client. The routing decision is made by the system, not by you. You always produce the same quality of plan.',
    '',
    'You are NOT a clinician. You do NOT diagnose. You DO flag clearly when something in the client input needs Emily\'s direct review.',
    '',
    'PROGRAMMING PRINCIPLES YOU MUST FOLLOW:',
    '1. Progressive overload across the plan duration. Include at least one deload week in any plan of 4+ weeks.',
    '2. Match training to the client\'s stated experience level.',
    '   - Beginners (less than 1 year): cap at 3 strength sessions/week; bodyweight + light external load for the first 2 weeks; RPE 6-7 ceiling for the first 2 weeks.',
    '   - Intermediates (1-3 years): up to 4 sessions/week; RPE 7-8.',
    '   - Advanced (3+ years): up to 5 sessions/week; RPE 8-9 with explicit monitoring cues.',
    '3. NEVER prescribe an exercise that requires equipment the client did not list. You will be given an AVAILABLE EXERCISE POOL. Choose only from it.',
    '4. Use the SPORT PROFILE provided to shape conditioning, power work, and injury-prevention focus.',
    '5. Cycle awareness: assume a typical 28-day cycle unless the client states otherwise. Where relevant, suggest where heavier strength work and higher-intensity conditioning fit best (typically follicular phase) and where deload, mobility, and aerobic work fit best (typically late luteal). Phrase as GUIDANCE, not prescription.',
    '6. Contraindications: read the injuries and medical fields carefully. Use the substitutes in the AVAILABLE EXERCISE POOL. That pool has already been filtered to remove exercises contraindicated by the client\'s stated history.',
    '',
    'CITATION RULE:',
    '- Any specific claim, statistic, or technique you offer that is NOT obvious general programming knowledge must come from a real named source: a peer-reviewed paper (author + year), a recognised authority (NICE, POGP, Aspetar, NHS, WHO, ACOG, ESHRE), or a widely-cited framework.',
    '- If you cannot name a real source you are confident exists, do NOT make the specific claim. Frame it as general principle instead.',
    '- Never invent citations, statistics, study findings, author names, or journal names.',
    '',
    'OUTPUT STRUCTURE. Use exactly these section headers, in this order:',
    '',
    '# FLAGS FOR EMILY REVIEW',
    '(List anything that should pause Emily before sending. If clear, write "None.")',
    '',
    '# CLIENT SNAPSHOT',
    '(2-3 lines summarising who they are, where they\'re starting, the key constraints.)',
    '',
    '# PLAN OVERVIEW',
    '(Goals, weekly structure at a glance, planned deload week(s), expected progression arc.)',
    '',
    '# WEEK-BY-WEEK PLAN',
    '(For each week:',
    '  ## Week N: [theme]',
    '  Focus:',
    '  Sessions:',
    '    • Session 1 (day type): exercises with sets x reps @ RPE, rest periods',
    '    • Session 2 ...',
    '  Cues for the week:',
    '  Cycle consideration:',
    '  How to know you\'re ready to progress: )',
    '',
    '# COACH NOTES',
    '(For each week, 2-4 lines:',
    '  ## Week N',
    '  Progression rationale:',
    '  What to watch for:',
    '  Adjust if: )',
    '',
    '# CONTRAINDICATED EXERCISES & SUBSTITUTES',
    '(Based on the client\'s injuries and medical input, list what you excluded and what you substituted in.)',
    '',
    '# OPEN QUESTIONS',
    '(Anything ambiguous in the input that should be clarified before sending. Always include at least one if anything is unclear. In standard plans these are questions the athlete can think about and track; in specialised tracks these are questions for Emily.)',
    '',
    'VOICE:',
    '- WEEK-BY-WEEK CLIENT VERSION sections: warm, direct, plain English, encouraging without hype. Match Emily\'s tone: grounded, practical. No motivational filler. No emojis. Avoid em-dashes and en-dashes (use periods, commas, or parentheses instead).',
    '- COACH NOTES sections: technical, concise, useful to a coach.',
  ].join('\n');
}

function buildPlanPrompt(input: {
  body: ConsultationWithPlanRequest;
  track: ProgramTrackId;
  sportProfile: SportProfile;
  exercisePool: Exercise[];
  avoidIfTags: string[];
}): string {
  const { body, track, sportProfile, exercisePool, avoidIfTags } = input;
  const trackProtocol = getTrackProtocol(track);
  const trackCitations = getTrackCitations(track);

  const sportProfileBlock = [
    `SPORT PROFILE. Use this to shape sport-specific conditioning, power work, and injury-prevention focus:`,
    `Sport: ${sportProfile.name}`,
    `Energy system: ${sportProfile.energy_system}`,
    `Primary demands: ${sportProfile.primary_demands.join(', ')}`,
    `Power emphasis: ${sportProfile.power_emphasis}`,
    `Contact load: ${sportProfile.contact_load}`,
    `Common injury hotspots: ${sportProfile.injury_hotspots.join(', ')}`,
    `Programming notes: ${sportProfile.programming_notes}`,
  ].join('\n');

  const exercisePoolBlock = [
    `AVAILABLE EXERCISE POOL. You MUST choose only from this filtered list (already screened for equipment, level, and contraindications):`,
    ...exercisePool.map(
      (ex) =>
        `- ${ex.name} [${ex.category}; equipment: ${ex.equipment.join('/')}]${ex.notes ? '. Notes: ' + ex.notes : ''}`
    ),
  ].join('\n');

  const trackBlock = trackProtocol
    ? [
        '─── SPECIALISED TRACK PROTOCOL ───',
        trackProtocol,
        '',
        'CITATIONS for this track (these are real, established sources you may reference by name):',
        ...trackCitations.map((c) => `- ${c}`),
      ].join('\n')
    : 'Track: standard (no specialised protocol applies).';

  const avoidBlock = avoidIfTags.length
    ? `DETECTED CONTRAINDICATION TAGS (already filtered out of the exercise pool): ${avoidIfTags.join(', ')}`
    : 'No specific contraindication tags detected from the input.';

  const clientBlock = [
    'CLIENT INPUT:',
    `- Age: ${body.age}`,
    `- Height: ${body.height || 'not provided'}`,
    `- Weight: ${body.weight || 'not provided'}`,
    `- Experience level: ${body.exerciseLevel || 'not provided'}`,
    `- Sports background: ${body.sportsOrNot || 'not provided'}`,
    `- Equipment available: ${(body.equipment || []).join(', ') || 'not provided'}`,
    `- Training frequency: ${body.frequencyPerWeek} sessions per week`,
    `- Plan duration: ${body.planDuration || '6 weeks'}`,
    `- Plan goals: ${(body.planGoals || []).join(', ')}`,
    `- Issues/concerns: ${body.issuesWorries || 'none provided'}`,
    `- Lifestyle: ${body.lifestyle || 'not provided'}`,
    `- Medical conditions: ${body.medicalConditions || 'none'}`,
    `- Injuries / limitations: ${body.injuries || 'none'}`,
    `- Cycle status: ${body.cycleStatus || 'not provided'}`,
    `- Current week looks like: ${body.currentWeek || 'not provided'}`,
    `- Anything else: ${body.anythingElse || 'not provided'}`,
    `- Specific goals narrative: ${body.goals}`,
  ].join('\n');

  return [
    `Create a ${body.planDuration || '6-week'} progression plan for the following female athlete client.`,
    '',
    sportProfileBlock,
    '',
    exercisePoolBlock,
    '',
    trackBlock,
    '',
    avoidBlock,
    '',
    clientBlock,
    '',
    'Follow the system prompt rules strictly. Use the exact output section headers it specifies.',
  ].join('\n');
}

// ─── Email sending ──────────────────────────────────────────────────

async function sendEmilyNotificationEmail(input: {
  body: ConsultationWithPlanRequest;
  generatedPlan: string;
  routing: RoutingDecision;
  redFlags: RedFlag[];
  track: ProgramTrackId;
  sportProfile: SportProfile;
}): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail = import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';

  if (!resendApiKey) {
    throw new Error('Missing RESEND_API_KEY environment variable.');
  }

  const { body, generatedPlan, routing, redFlags, track, sportProfile } = input;

  const headerLines: string[] = [];
  if (routing.flagLabel) {
    headerLines.push('');
    headerLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    headerLines.push(routing.flagLabel);
    headerLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    headerLines.push(`Reason: ${routing.reason}`);
    if (redFlags.length) {
      headerLines.push('');
      headerLines.push('FLAGGED ISSUES:');
      for (const f of redFlags) {
        headerLines.push(`  • ${f.id}: ${f.reason}`);
      }
    }
    headerLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    headerLines.push('');
  }

  const planBlock = routing.shouldGeneratePlan
    ? generatedPlan
      ? `\n\nAI-GENERATED PLAN (draft, requires your review)\n----------------\n${generatedPlan}`
      : '\n\nAI-GENERATED PLAN\n----------------\nNo plan generated (plan generation skipped or failed).'
    : '\n\nAI-GENERATED PLAN\n----------------\nNo plan generated. Routing decision required a clinical pause.';

  const destinationLine =
    routing.destination === 'client'
      ? 'AUTONOMOUS MODE: this plan was ALSO sent directly to the client.'
      : 'REVIEW MODE: this plan was sent to you only. The client has not received it.';

  const subjectPrefix =
    routing.flagLabel || (track !== 'standard' ? `[${track.toUpperCase()}]` : '');

  const subject = `${subjectPrefix ? subjectPrefix + ' ' : ''}New consultation: ${body.name}`.trim();

  const text =
    [
      ...headerLines,
      'NEW CONSULTATION REQUEST',
      destinationLine,
      '',
      `Submitted: ${new Date().toISOString()}`,
      `Name: ${body.name}`,
      `Email: ${body.email}`,
      `Phone: ${body.phone || 'Not provided'}`,
      `Sport/Team: ${body.sport} (matched profile: ${sportProfile.name})`,
      `Preferred contact method: ${body.contactMethod}`,
      `Preferred time: ${body.preferredTime || 'Not provided'}`,
      '',
      `Program track: ${track}`,
      `Cycle status: ${body.cycleStatus || 'Not provided'}`,
      `Stripe session: ${body.sessionId || 'Not provided (free intake submission)'}`,
      '',
      'CLIENT GOALS',
      '------------',
      body.goals,
      '',
      'TRAINING PLAN INPUT',
      '-------------------',
      `Include progression plan: ${body.includeProgressionPlan ? 'Yes' : 'No'}`,
      `Age: ${body.age ?? 'Not provided'}`,
      `Height: ${body.height || 'Not provided'}`,
      `Weight: ${body.weight || 'Not provided'}`,
      `Exercise level: ${body.exerciseLevel || 'Not provided'}`,
      `Sports background: ${body.sportsOrNot || 'Not provided'}`,
      `Equipment: ${body.equipment?.join(', ') || 'Not provided'}`,
      `Frequency per week: ${body.frequencyPerWeek ?? 'Not provided'}`,
      `Plan duration: ${body.planDuration || 'Not provided'}`,
      `Plan goals: ${body.planGoals?.join(', ') || 'Not provided'}`,
      `Issues/worries: ${body.issuesWorries || 'Not provided'}`,
      `Lifestyle: ${body.lifestyle || 'Not provided'}`,
      `Medical conditions: ${body.medicalConditions || 'Not provided'}`,
      `Injuries: ${body.injuries || 'Not provided'}`,
      `Current week: ${body.currentWeek || 'Not provided'}`,
      `Anything else: ${body.anythingElse || 'Not provided'}`,
    ].join('\n') + planBlock;

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
    throw new Error(`Failed to send consultation email: ${response.status} ${details}`);
  }
}

async function sendClientPlanEmail(input: {
  body: ConsultationWithPlanRequest;
  generatedPlan: string;
  sportProfile: SportProfile;
}): Promise<void> {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail = import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';

  if (!resendApiKey) {
    throw new Error('Missing RESEND_API_KEY environment variable.');
  }

  const { body, generatedPlan, sportProfile } = input;

  const text = [
    `Hi ${body.name.split(' ')[0]},`,
    '',
    `Thanks for sharing your details. Below is your draft ${body.planDuration || '6-week'} progression plan, built around your goals, your sport (${sportProfile.name}), and the equipment you have access to.`,
    '',
    'A few important notes before you start:',
    '- This plan is educational guidance, not clinical or medical advice.',
    '- If anything in the plan feels off, painful, or unclear, stop and email me at ' + EMILY_EMAIL + '.',
    '- If you experience new pain, symptoms, or a change in how your body is responding, contact your doctor or physio.',
    '',
    '──────────────────────────────────────────',
    '',
    generatedPlan,
    '',
    '──────────────────────────────────────────',
    '',
    'Once you\'ve had a read through, if you want to talk it through, book a 1:1 chat with me here: ' + EMILY_CALENDAR_BOOKING_URL,
    '',
    'You can also reach me any time at ' + EMILY_EMAIL + '. I want to know how you get on.',
    '',
    'Emily',
    'Mind the Gael',
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [body.email],
      subject: `Your ${body.planDuration || '6-week'} plan from Mind the Gael`,
      text,
      reply_to: EMILY_EMAIL,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'No response body');
    throw new Error(`Failed to send client plan email: ${response.status} ${details}`);
  }
}

// ─── Client response ────────────────────────────────────────────────

function buildClientResponse(
  routing: RoutingDecision,
  redFlags: RedFlag[]
): { success: true; message: string } {
  // Red-flag messages take priority — the first matching flag provides the message.
  if (redFlags.length > 0) {
    const flagWithMessage = redFlags.find((f) => f.clientMessage);
    if (flagWithMessage?.clientMessage) {
      return { success: true, message: flagWithMessage.clientMessage };
    }
    return {
      success: true,
      message:
        'Thank you for sharing this. Emily will reach out personally within 48 hours to talk through your situation before any training plan is put together.',
    };
  }

  if (routing.destination === 'client' && routing.shouldGeneratePlan) {
    return {
      success: true,
      message:
        'Your plan has been sent to the email you provided. Check your inbox in the next few minutes. If you don\'t see it, check your spam folder, then email Emily at ' +
        EMILY_EMAIL +
        ' if it didn\'t arrive.',
    };
  }

  // Default: v1 standard plan or specialised track — Emily will review and follow up.
  return {
    success: true,
    message:
      'Your consultation request has been received. Emily will review your details and any custom progression plan within 48 hours and be in touch.',
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function jsonResponse(payload: any, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function getErrorMessage(error: any): string {
  if (error?.message?.includes('RESEND_API_KEY')) {
    return 'Consultation email service is not configured yet. Please add RESEND_API_KEY in environment variables.';
  }
  if (error?.message?.includes('ANTHROPIC_API_KEY')) {
    return 'AI service is not configured yet. Please add ANTHROPIC_API_KEY in environment variables.';
  }
  if (error?.message?.includes('Failed to send')) {
    return 'Could not send the consultation email. Please check that your Resend sender email/domain is verified.';
  }
  if (error?.message?.toLowerCase?.().includes('rate limit')) {
    return 'AI rate limit reached. Please try again shortly.';
  }
  if (error?.message?.toLowerCase?.().includes('model')) {
    return 'Configured Anthropic model is not available for this API key. Please update ANTHROPIC_MODEL_PLAN.';
  }
  return 'Failed to process consultation request.';
}
