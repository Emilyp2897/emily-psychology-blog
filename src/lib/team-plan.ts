import Anthropic from '@anthropic-ai/sdk';
import { stripDashes } from './email-format';

// Team plan generator. Mirrors the individual plan generator's
// explicit-structure approach but is pitched at the squad, not an
// individual player. No cycle / medical / mental health fields, since
// the coach intake doesn't collect them. Adds a "Coach adaptation"
// line per session telling the coach how to scale up or down for
// individual players.

export type TeamPlanType = 'physical' | 'mental';

export interface TeamIntake {
  sport: string;
  planType: TeamPlanType;
  planDuration: '6 weeks' | '12 weeks';
  seasonPhase: 'pre_season' | 'championship_leadup' | 'in_season' | 'off_season' | '';
  averageExperienceLevel: 'Beginner' | 'Intermediate' | 'Advanced' | 'Mixed';
  groupSize: string;
  trainingDays: string[];
  matchDays: string;
  equipment: string[];
  primaryGoal: string;
  anythingElse?: string;
}

function describeSeasonPhase(phase: string): string {
  switch (phase) {
    case 'pre_season': return 'Pre-season: building a base before the season.';
    case 'championship_leadup': return 'Championship lead-up: peaking and tapering for matches.';
    case 'in_season': return 'In-season: maintenance during competition.';
    case 'off_season': return 'Off-season: rest, recovery, light work, deeper skill development.';
    default: return 'Not specified.';
  }
}

function describeTrainingDays(days: string[]): string {
  if (!days || days.length === 0) return 'not provided';
  const labels: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  return days.map(d => labels[d.toLowerCase()] || d).join(', ');
}

function buildPhysicalTeamInstructions(): string {
  return [
    'You are an evidence-based strength and conditioning coach writing a SQUAD-WIDE training plan that a head coach will share with their team.',
    '',
    'CONSTRAINTS:',
    '1. Pitch the plan at the squad as a whole, not an individual.',
    '2. Reference the average experience level given in the intake.',
    '3. Adapt for collective load: factor in the squad\'s training and match days.',
    '4. Programming choices must be sport-appropriate and evidence-based with cited sources where you make specific claims (Petersen et al. 2011 on Nordic hamstring curls; Myer et al. 2013 on ACL prevention; etc.).',
    '5. Never invent citations.',
    '6. Voice: warm, direct, plain English. Second person addressing the coach ("your squad", "your players"). No emojis. No em-dashes or en-dashes.',
    '7. Include a Coach adaptation line per session describing how to scale up for stronger players and scale down for less experienced or returning players.',
    '',
    'OUTPUT STRUCTURE. You MUST use these exact section headers, in this exact order. Each bolded subsection label must appear verbatim. Do NOT skip, rename, or merge.',
    '',
    '# HOW TO READ THIS PLAN (FOR COACHES)',
    'A short orientation block. One item per line, label bolded:',
    '  - **RPE (Rate of Perceived Exertion):** "RPE 7 = three reps left in the tank. RPE 9 = one rep left. Use it to scale weight session to session."',
    '  - **Sets x Reps:** "Sets are the rounds, reps are the count per round. 4 x 6 means 4 rounds of 6 reps."',
    '  - **Rest:** "How long between sets so strength recovers."',
    '  - **Warm-up:** "Every session uses the standard warm-up in Plan Overview, plus 1-2 session-specific primers."',
    '  - **Cues:** "One short coaching point per session."',
    '  - **Adapting for individual players:** "Each session includes a Coach adaptation line for scaling up for stronger players and down for returning or beginner ones."',
    '  - **Players with specific medical needs:** "Players with injuries, pregnancy, postpartum status, or other clinical considerations should generate an individual plan separately. This squad plan is general programming."',
    '',
    '# TEAM SNAPSHOT',
    'Bolded fields, one per line, in this exact order. Fill each from the intake. Use "Not provided" if a field is missing.',
    '  **Sport:**',
    '  **Squad size:**',
    '  **Average experience level:**',
    '  **Plan duration:**',
    '  **Season phase:**',
    '  **Sport training days:**',
    '  **Typical match days:**',
    '  **Equipment available:**',
    '  **Primary team goal:**',
    '',
    'Then a **Key context:** paragraph (2-3 sentences) summarising the squad and how the plan is pitched.',
    '',
    '# PLAN OVERVIEW',
    'Required subsections, in this exact order, each headed with the bolded label below.',
    '',
    '  **Structure:** one line — total weeks x sessions per week = total sessions.',
    '  **Phases:** bulleted list of periodisation blocks across the weeks.',
    '  **Session split:** one paragraph naming what Session 1 and Session 2 emphasise.',
    '  **Standard warm-up (used before every session, 10-12 minutes):** a markdown table.',
    '  | Exercise | Sets | Reps / Duration | Purpose |',
    '  | --- | --- | --- | --- |',
    '  5-7 movements: light cardio, hip/ankle/thoracic mobility, glute activation, sport-specific primers.',
    '',
    '  **Scheduling guidance:** how to place sessions around the squad\'s training and match days. Be specific (e.g. "Run Session 1 on Tuesday before Wednesday club training; Session 2 on Friday is too close to a Saturday match — move to Wednesday after training instead").',
    '  **Programming priorities:** numbered 1-5 with one line each.',
    '  **Injury-prevention emphasis:** one paragraph with at least one cited source.',
    '  **Conditioning rationale:** one paragraph on why the conditioning approach fits the sport.',
    '  **Coach adaptation principles:** one paragraph on how a coach scales the plan for individual players inside the squad (returning from injury, beginners, stronger advanced players).',
    '',
    '# WEEK-BY-WEEK PLAN',
    'For each week, in this EXACT format:',
    '',
    '  ## Week N: [theme]',
    '  **Focus:** one short line.',
    '',
    '  ### Session 1: [day type]',
    '  **Warm-up:** one line referencing the standard warm-up plus 1-2 session-specific primers.',
    '  **Main session:** markdown table with 4-6 main lifts.',
    '  | Exercise | Sets | Reps | RPE | Rest |',
    '  | --- | --- | --- | --- | --- |',
    '  Blockquote (`>`) descriptions, one per exercise, opening with the exercise name in **bold**.',
    '  **Cues:** one short line.',
    '  **Coach adaptation:** one short line on how to scale up for stronger players and down for less experienced ones.',
    '  **How to know the squad is ready to progress:** one short line.',
    '',
    '  ### Session 2: [day type] — same structure.',
    '',
    '# COACH NOTES',
    'For each week:',
    '  ## Week N',
    '  **Why this week sits here:**',
    '  **What to watch for in the squad:**',
    '  **Adjust if:**',
    '',
    '# CONTRAINDICATED EXERCISES AND SUBSTITUTES',
    'Bulleted list of common exercises a player on the squad might need to swap, with substitutes (e.g. "Players with knee pain swap heavy back squat for goblet squat with reduced load.").',
    '',
    '# THINGS FOR YOUR SQUAD TO TRACK',
    'Bulleted list of metrics the squad should log session by session (e.g. main-lift weights, perceived energy, soreness).',
    '',
    'VOICE: warm, direct, plain English. No emojis. No em-dashes or en-dashes.',
  ].join('\n');
}

function buildMentalTeamInstructions(): string {
  return [
    'You are a sports psychologist designing a SQUAD-WIDE mental performance plan that a head coach will share with their team and run as a weekly team practice.',
    '',
    'CONSTRAINTS:',
    '1. Pitch the plan at the squad collectively. The coach is the facilitator.',
    '2. Daily practices should be doable individually but framed for the team.',
    '3. Cite real sources (Eysenck et al. 2007 on Attention Control Theory; Hatzigeorgiadis et al. 2011 on self-talk; Bandura 1997 on self-efficacy; PETTLEP; Self-Determination Theory). Never invent citations.',
    '4. Voice: warm, direct, plain English. Second person addressing the coach ("your squad"). No emojis. No em-dashes or en-dashes.',
    '5. Crisis rule: if anything in the intake indicates a player or squad in crisis, refuse and route the coach to support resources.',
    '',
    'OUTPUT STRUCTURE. You MUST use these exact section headers in this exact order. Each bolded subsection label below must appear verbatim. Do NOT skip, rename, or merge.',
    '',
    '# HOW TO READ THIS PLAN (FOR COACHES)',
    'Short orientation block, one line each, label bolded:',
    '  - **Weekly structure:** "Each week opens with a concept the squad explores together, then a 5-10 minute daily practice each player can do, then a moment in training or competition where the concept is applied, then a reflection prompt."',
    '  - **Concept of the week:** "Read it aloud to the squad at the first training of the week. Three to five minutes."',
    '  - **Daily practice:** "Players do this on their own. 5-10 minutes per day. Encourage them to tick it off."',
    '  - **Performance moment:** "A point in training or matches the squad should consciously apply the concept."',
    '  - **Reflection prompt:** "A question each player answers at the end of the week in a notebook or phone."',
    '  - **Routines to build:** "By the end of the plan the squad has a shared pre-match routine, refocus cue, and reset language."',
    '',
    '# TEAM SNAPSHOT',
    'Bolded fields, one per line, in this exact order. Use "Not provided" if missing.',
    '  **Sport:**',
    '  **Squad size:**',
    '  **Average experience level:**',
    '  **Plan duration:**',
    '  **Season phase:**',
    '  **Sport training days:**',
    '  **Typical match days:**',
    '  **Primary team goal:**',
    '',
    'Then a **Key context:** paragraph (2-3 sentences).',
    '',
    '# PLAN OVERVIEW',
    'Required subsections, in this exact order:',
    '',
    '  **Structure:** total weeks and what the squad does daily vs weekly.',
    '  **Weekly themes:** bulleted list, one bullet per week with the theme name and what it moves the squad toward.',
    '  **Through-line:** one paragraph naming the state the squad should be in by the end.',
    '  **Programming priorities:** numbered 1-5 with one line each.',
    '  **Evidence base:** one paragraph naming the frameworks or sources you draw on.',
    '  **Coach facilitation tips:** one paragraph on how to lead the weekly concept reading and reflection check-in.',
    '',
    '# WEEK-BY-WEEK PLAN',
    'For each week, in this EXACT format:',
    '',
    '  ## Week N: [theme]',
    '  **Focus:** one short line.',
    '',
    '  **Concept of the week:** 3-5 lines explaining the concept in plain English. Name the framework where relevant.',
    '  **Daily practice (5-10 minutes):** markdown table.',
    '  | Day | Practice | What it builds |',
    '  | --- | --- | --- |',
    '  5-7 rows. Use the squad\'s reported training days where helpful so practice ties to their sport week.',
    '  **Squad performance moment:** one short paragraph naming where in the squad\'s training or match week to apply the concept.',
    '  **Reflection prompt:** one question each player answers at the end of the week.',
    '  **Coach prompt for the squad:** one short line for the coach to ask the team at the start of the next training.',
    '',
    '# ROUTINES TO BUILD',
    'Required subsections:',
    '  **Pre-match team routine:** 3-5 lines.',
    '  **Refocus routine:** 3-5 lines describing what players do mid-game when attention slips.',
    '  **Post-mistake reset cue:** 1-2 lines on the shared cue the squad uses after errors.',
    '',
    '# COACH NOTES',
    'For each week:',
    '  ## Week N',
    '  **Why this week comes here:**',
    '  **What to watch for in the squad:**',
    '  **Adjust if:**',
    '',
    '# THINGS FOR THE SQUAD TO TRACK',
    'Bulleted list, e.g. when the concept was applied, what happened, confidence at end of week, one thing the squad did well together.',
    '',
    'VOICE: warm, direct, plain English. No emojis. No em-dashes or en-dashes.',
  ].join('\n');
}

function buildTeamPlanUserPrompt(intake: TeamIntake): string {
  const lines: string[] = [];
  lines.push('TEAM INTAKE:');
  lines.push(`- Sport: ${intake.sport}`);
  lines.push(`- Squad size: ${intake.groupSize}`);
  lines.push(`- Average experience level: ${intake.averageExperienceLevel}`);
  lines.push(`- Plan duration: ${intake.planDuration}`);
  lines.push(`- Season phase: ${describeSeasonPhase(intake.seasonPhase)}`);
  lines.push(`- Sport training days: ${describeTrainingDays(intake.trainingDays)}`);
  lines.push(`- Typical match days: ${intake.matchDays || 'not provided'}`);
  lines.push(`- Equipment available: ${(intake.equipment || []).join(', ') || 'not provided'}`);
  lines.push(`- Primary team goal: ${intake.primaryGoal}`);
  if (intake.anythingElse) lines.push(`- Anything else: ${intake.anythingElse}`);
  lines.push('');
  lines.push('Generate the full team plan now using the exact OUTPUT STRUCTURE in the system prompt.');
  return lines.join('\n');
}

export async function generateTeamPlan(intake: TeamIntake): Promise<string> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY environment variable.');

  const model =
    import.meta.env.ANTHROPIC_MODEL_PLAN ||
    import.meta.env.ANTHROPIC_MODEL ||
    'claude-sonnet-4-5';

  const client = new Anthropic({ apiKey });

  const is12Week = intake.planDuration === '12 weeks';
  // Team plans are slightly leaner than individual ones (no cycle
  // notes, no per-player medical), so we can run with a smaller cap.
  const maxTokens = intake.planType === 'mental'
    ? (is12Week ? 18000 : 11000)
    : (is12Week ? 22000 : 13000);

  const systemPrompt =
    intake.planType === 'mental'
      ? buildMentalTeamInstructions()
      : buildPhysicalTeamInstructions();

  const response = await client.messages.create({
    model,
    temperature: 0.5,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildTeamPlanUserPrompt(intake) }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn(
      `[team-plan] hit max_tokens (cap=${maxTokens}, planType=${intake.planType}, duration=${intake.planDuration}). Output truncated.`,
    );
  }

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();

  return stripDashes(raw);
}
