import type { ConsultationWithPlanRequest, ProgramTrack, ProgramTrackId } from './types';

// ────────────────────────────────────────────────────────────────────
// NOTE FOR EMILY (PLEASE VALIDATE CITATIONS BEFORE LAUNCH):
//
// Each track below has a protocol the training-plan model is required to
// follow, plus a citations list of established frameworks I drew on.
// These citations are real organisations and (where named) real,
// widely-cited papers — but please verify each one against the edition
// or version you trust, and add any preferred sources of your own.
//
// All four tracks ALWAYS route to Emily for manual review, both in v1
// (current) and v2 (autonomous), per the routing rules in
// plan-routing.ts.
// ────────────────────────────────────────────────────────────────────

const PREGNANCY_PATTERNS = [/pregnan/i, /expecting/i, /first trimester/i, /second trimester/i, /third trimester/i];

const POSTPARTUM_PATTERNS = [
  /postpartum/i,
  /post.?partum/i,
  /just had a baby/i,
  /recently had a baby/i,
  /had a baby (last|in)/i,
  /breastfeeding/i,
  /nursing.*baby/i,
  /\bweeks postnatal\b/i,
];

const ENDOMETRIOSIS_PATTERNS = [
  /endometrios/i,
  /\bendo\b/i,
  /endometrial/i,
  /pelvic pain.*chronic/i,
];

const RTP_PATTERNS = [
  /return to play/i,
  /return.to.sport/i,
  /\brtp\b/i,
  /post.?op.*returning/i,
  /coming back from/i,
  /returning from injury/i,
  /just had surgery/i,
  /post.surgical/i,
  /rehabbing/i,
  /rehab.*sport/i,
];

function matchAny(haystack: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(haystack));
}

function buildHaystack(input: ConsultationWithPlanRequest): string {
  return [
    input.issuesWorries || '',
    input.medicalConditions || '',
    input.injuries || '',
    input.anythingElse || '',
    input.lifestyle || '',
    input.goals || '',
  ].join(' ');
}

export const PROGRAM_TRACKS: ProgramTrack[] = [
  {
    id: 'pregnancy',
    name: 'Pregnancy',
    detect: (input) =>
      input.programTrack === 'pregnancy' ||
      input.cycleStatus === 'pregnant_or_postpartum' ||
      matchAny(buildHaystack(input), PREGNANCY_PATTERNS),
    citations: [
      'NHS: Exercise in pregnancy guidance (nhs.uk/pregnancy/keeping-well/exercise)',
      'ACOG Committee Opinion 804 (2020): Physical Activity and Exercise During Pregnancy and the Postpartum Period',
      'Mottola et al. (2018): 2019 Canadian guideline for physical activity throughout pregnancy. BJSM 52(21)',
    ],
    protocol: `
PROGRAM TRACK: PREGNANCY

You are writing a pregnancy-specific draft for Emily to review. Do NOT
produce a plan that you would consider safe to auto-send. This is
always a human-reviewed track.

Programming rules:
- Trimester awareness: assume the client may be in any trimester unless
  stated. Bias to conservative volume and intensity, especially in T1
  (high miscarriage-risk window) and T3 (mechanical limits).
- AVOID: supine positions held for more than a few minutes after T1;
  Valsalva manoeuvre and breath-holding under load; high-impact
  plyometrics; contact sport drills; deep prone work in T2/T3;
  exercises with fall risk; exercises that cause coning of the abdomen;
  anything that increases pelvic floor pressure beyond tolerance.
- PREFER: walking, stationary cycling, swimming, low-impact strength
  with submaximal loads (RPE 5-7), pelvic floor activation,
  diaphragmatic breathing, glute and back strengthening to counter
  posture changes, controlled mobility.
- Intensity guide: keep below "can hold a conversation"; use the
  talk-test rather than max heart rate.
- Plan structure: 3 sessions per week unless the client has been
  consistently exercising at higher frequency throughout the pregnancy.
  Include explicit "stop and contact Emily" signs (pain, bleeding,
  contractions, fluid loss, persistent dizziness, swelling).

The output should make clear this is a draft for Emily's review and
contains explicit "open questions" for Emily: trimester, any
complications, OB/midwife clearance status.
`.trim(),
  },
  {
    id: 'postpartum',
    name: 'Postpartum',
    detect: (input) =>
      input.programTrack === 'postpartum' ||
      matchAny(buildHaystack(input), POSTPARTUM_PATTERNS),
    citations: [
      'Goom, Donnelly, Brockwell (2019): Returning to running postnatal: guidelines for medical, health and fitness professionals managing this population.',
      'POGP (Pelvic, Obstetric & Gynaecological Physiotherapy): Fit for Birth, Fit for the Future leaflet and postnatal guidance.',
      'ACOG Committee Opinion 804 (2020): postpartum activity guidance.',
    ],
    protocol: `
PROGRAM TRACK: POSTPARTUM

You are writing a postpartum-specific draft for Emily to review. Do NOT
auto-send. This is always a human-reviewed track.

Phased return. Assume the client is in one of these unless stated:
- 0-6 weeks: walking, pelvic floor activation, diaphragmatic breathing,
  gentle reconnection work. NO running, NO heavy lifting, NO jumping,
  NO Valsalva.
- 6-12 weeks: progressive bodyweight strength, controlled glute and
  hinge work (avoiding intra-abdominal pressure spikes), continued
  pelvic floor work, longer walks, low-impact aerobic.
- 12 weeks+: gradual reintroduction of running (Goom et al. 2019
  return-to-running checklist applies), progressive loading, light
  plyometric reintroduction only when pelvic floor and core control
  meet criteria.

Screen for: diastasis recti (avoid coning, prone work, sit-ups, planks
if separation > 2 finger widths), pelvic floor symptoms (leakage,
heaviness, pain), back pain, c-section recovery (no abdominal loading
for 12+ weeks).

PREFER: dead bug, bird dog, side plank progressions, glute bridge
progressions, supported hip thrust, RDL with light load, single-leg
work, supine-to-sitting bridge transitions, suitcase carries.

AVOID until cleared: deep crunching, sit-ups, full front plank, heavy
deadlift, full-effort sprinting, depth jumps, max-load Valsalva.

Always include explicit "stop and contact Emily" signs (heaviness
sensation, leakage, pain, sudden return of bleeding). Output must flag
this for Emily's review and include open questions: weeks postnatal,
birth type (vaginal / c-section), pelvic floor screening status,
breastfeeding status, sleep state.
`.trim(),
  },
  {
    id: 'endometriosis',
    name: 'Endometriosis',
    detect: (input) =>
      input.programTrack === 'endometriosis' ||
      matchAny(buildHaystack(input), ENDOMETRIOSIS_PATTERNS),
    citations: [
      'ESHRE Endometriosis Guideline (Becker et al., 2022): European Society of Human Reproduction and Embryology.',
      "Hansen, Knudsen (2017): Exercise as a treatment for chronic pain: systematic review (relevant for endo's pain phases). [VERIFY: medium-confidence citation. Emily to confirm exact title/year before publishing publicly]",
      'NICE NG73: Endometriosis: diagnosis and management.',
    ],
    protocol: `
PROGRAM TRACK: ENDOMETRIOSIS

You are writing an endometriosis-aware draft for Emily to review. Do
NOT auto-send.

Programming rules:
- Two-mode programming: a baseline plan AND a "symptomatic day"
  alternative. The client should be able to switch to the symptomatic
  alternative on flare days without losing structure.
- BASELINE (low-symptom days): standard strength + conditioning
  programming, with priority on posterior chain, hip mobility, and
  controlled core. Aerobic work is well-tolerated by most clients with
  endometriosis and has supportive evidence (low-to-moderate intensity).
- SYMPTOMATIC DAYS: low-intensity aerobic (walking, stationary
  cycling), gentle mobility, restorative work. No high-intensity
  conditioning. No prolonged Valsalva or sustained intra-abdominal
  pressure spikes.
- AVOID: programming that loads through pelvic-floor-pressure-spiking
  movements during symptomatic phases (heavy Valsalva lifts, high-impact
  plyometrics, deep loaded hinging); inflexible "must hit this session"
  framing that doesn't accommodate flare days.
- PREFER: yoga / pilates-style strength elements have evidence of
  symptom benefit; aerobic exercise has anti-inflammatory benefit;
  resistance training maintains athletic capacity through symptom cycles.

Output must include both modes per week, frame flare-day modification
as a planned feature (not a failure), and ask Emily to clarify the
client's typical symptom pattern.
`.trim(),
  },
  {
    id: 'return_to_play',
    name: 'Return to play from injury',
    detect: (input) =>
      input.programTrack === 'return_to_play' ||
      matchAny(buildHaystack(input), RTP_PATTERNS),
    citations: [
      'Ardern CL, et al. (2016): 2016 Consensus statement on return to sport from the First World Congress in Sports Physical Therapy, Bern. BJSM 50(14).',
      'Aspetar (Qatar Orthopaedic and Sports Medicine Hospital): Return to Sport clinical practice guidelines.',
      'Hägglund, Waldén, Atroshi (2009): ACL injury and risk of subsequent ACL injury (relevant for ACL-specific RTP). [VERIFY: medium-confidence citation. Emily to confirm exact title/year before publishing publicly]',
    ],
    protocol: `
PROGRAM TRACK: RETURN TO PLAY FROM INJURY

You are writing a return-to-play draft for Emily to review. Do NOT
auto-send.

Five-phase RTP framework (Ardern 2016 / Aspetar):
1. Return to participation: controlled, non-painful loading;
   regaining range; fundamental movement quality.
2. Return to training: structured S&C in the same domain as the
   sport (but not full sport-specific); progressive plyometric
   reintroduction.
3. Return to running: criteria-based (pain-free walking, single-leg
   capacity, hop tests), not time-based.
4. Return to sport: sport-specific drills, change of direction,
   contact reintroduction where relevant, deceleration training.
5. Return to performance / competition: full match demands,
   intensity matching.

Programming rules:
- Criteria-based progression, NOT time-based. The plan should specify
  what criteria must be met before progressing to the next phase.
- Build in the deficit (single-leg strength asymmetry, hop test scores,
  range of motion benchmarks). The model should ASK Emily for these
  in the Open Questions section, not invent them.
- Sport-specific reinjury risk is a priority concern: ACL re-rupture
  rates remain elevated for 12+ months post-surgery; soft-tissue
  injuries reinjure at higher rates within the first weeks back.
- AVOID: skipping phases; jumping straight to sport-specific work;
  ignoring asymmetry data.
- PREFER: bilateral strength foundations, single-leg loading,
  eccentric strength for the injured tissue, plyometric progression
  ladder, neuromuscular control work, return-to-running using a
  graded walk-to-run protocol if applicable.

Output must specify the assumed phase, list the criteria that would
move the client to the next phase, and ask Emily to confirm phase and
injury specifics in Open Questions.
`.trim(),
  },
];

export function determineTrack(input: ConsultationWithPlanRequest): ProgramTrackId {
  // Explicit form selection takes priority
  if (input.programTrack && input.programTrack !== 'standard') {
    return input.programTrack;
  }
  // Otherwise detect from text
  for (const track of PROGRAM_TRACKS) {
    if (track.detect(input)) return track.id;
  }
  return 'standard';
}

export function getTrackProtocol(trackId: ProgramTrackId): string | null {
  if (trackId === 'standard') return null;
  const track = PROGRAM_TRACKS.find((t) => t.id === trackId);
  return track ? track.protocol : null;
}

export function getTrackCitations(trackId: ProgramTrackId): string[] {
  if (trackId === 'standard') return [];
  const track = PROGRAM_TRACKS.find((t) => t.id === trackId);
  return track ? track.citations : [];
}
