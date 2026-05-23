import type { Exercise, EquipmentTag, ExperienceLevel } from './types';

// ────────────────────────────────────────────────────────────────────
// NOTE FOR EMILY (PLEASE VALIDATE):
//
// This is a curated starter pool of ~50 exercises spanning the main
// movement categories. The training-plan model is constrained to choose
// from this list (it cannot invent exercises or specify equipment the
// client did not list).
//
// Please review for: anything you would NOT prescribe, anything missing
// that you commonly use, and tag corrections (especially `avoid_if` —
// the contraindication tags are what stop the model from prescribing
// risky exercises to clients with relevant history).
// ────────────────────────────────────────────────────────────────────

export const EXERCISES: Exercise[] = [
  // ── SQUAT ──
  { name: 'Bodyweight squat', category: 'squat', equipment: ['bodyweight'], level: ['beginner'], avoid_if: ['acute_knee_pain'] },
  { name: 'Goblet squat', category: 'squat', equipment: ['dumbbells', 'kettlebell'], level: ['beginner', 'intermediate'], avoid_if: ['acute_knee_pain'] },
  { name: 'Box squat', category: 'squat', equipment: ['box', 'bodyweight', 'dumbbells'], level: ['beginner', 'intermediate'], avoid_if: [] },
  { name: 'Front squat', category: 'squat', equipment: ['barbell', 'gym_access'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain', 'wrist_injury'] },
  { name: 'Back squat', category: 'squat', equipment: ['barbell', 'gym_access'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain', 'lower_back_acute'] },

  // ── HINGE ──
  { name: 'Hip hinge drill', category: 'hinge', equipment: ['bodyweight'], level: ['beginner'], avoid_if: [] },
  { name: 'Glute bridge', category: 'hinge', equipment: ['bodyweight'], level: ['beginner'], avoid_if: [] },
  { name: 'Hip thrust', category: 'hinge', equipment: ['bodyweight', 'dumbbells', 'barbell'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Dumbbell Romanian deadlift', category: 'hinge', equipment: ['dumbbells'], level: ['beginner', 'intermediate'], avoid_if: ['lower_back_acute'] },
  { name: 'Barbell Romanian deadlift', category: 'hinge', equipment: ['barbell'], level: ['intermediate', 'advanced'], avoid_if: ['lower_back_acute'] },
  { name: 'Single-leg Romanian deadlift', category: 'hinge', equipment: ['bodyweight', 'dumbbells', 'kettlebell'], level: ['intermediate', 'advanced'], avoid_if: ['acute_ankle_injury'] },
  { name: 'Kettlebell swing', category: 'hinge', equipment: ['kettlebell'], level: ['intermediate', 'advanced'], avoid_if: ['lower_back_acute'] },
  { name: 'Conventional deadlift', category: 'hinge', equipment: ['barbell'], level: ['intermediate', 'advanced'], avoid_if: ['lower_back_acute', 'recent_postpartum_under_12wk'] },
  { name: 'Nordic hamstring curl', category: 'hinge', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['hamstring_acute'], notes: 'Strong ACL/hamstring injury prevention evidence.' },

  // ── LUNGE ──
  { name: 'Reverse lunge', category: 'lunge', equipment: ['bodyweight', 'dumbbells'], level: ['beginner', 'intermediate'], avoid_if: ['acute_knee_pain'] },
  { name: 'Walking lunge', category: 'lunge', equipment: ['bodyweight', 'dumbbells'], level: ['beginner', 'intermediate'], avoid_if: ['acute_knee_pain'] },
  { name: 'Lateral lunge', category: 'lunge', equipment: ['bodyweight', 'dumbbells'], level: ['beginner', 'intermediate'], avoid_if: ['groin_acute'] },
  { name: 'Bulgarian split squat', category: 'lunge', equipment: ['bodyweight', 'dumbbells'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain'] },
  { name: 'Step-up', category: 'lunge', equipment: ['box', 'bodyweight', 'dumbbells'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },

  // ── UPPER PUSH ──
  { name: 'Incline push-up', category: 'upper_push', equipment: ['bodyweight', 'box'], level: ['beginner'], avoid_if: ['wrist_injury'] },
  { name: 'Push-up', category: 'upper_push', equipment: ['bodyweight'], level: ['beginner', 'intermediate'], avoid_if: ['wrist_injury', 'diastasis_recti'] },
  { name: 'Dumbbell bench press', category: 'upper_push', equipment: ['dumbbells'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Dumbbell shoulder press', category: 'upper_push', equipment: ['dumbbells'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: ['shoulder_acute'] },
  { name: 'Landmine press', category: 'upper_push', equipment: ['barbell'], level: ['intermediate', 'advanced'], avoid_if: ['shoulder_acute'] },
  { name: 'Barbell bench press', category: 'upper_push', equipment: ['barbell', 'gym_access'], level: ['intermediate', 'advanced'], avoid_if: ['shoulder_acute'] },

  // ── UPPER PULL ──
  { name: 'Band pull-apart', category: 'upper_pull', equipment: ['resistance_bands'], level: ['beginner', 'intermediate'], avoid_if: [] },
  { name: 'Ring row / TRX row', category: 'upper_pull', equipment: ['bodyweight', 'resistance_bands'], level: ['beginner', 'intermediate'], avoid_if: [] },
  { name: 'Dumbbell row', category: 'upper_pull', equipment: ['dumbbells'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: ['lower_back_acute'] },
  { name: 'Single-arm cable row', category: 'upper_pull', equipment: ['cable_machine', 'gym_access'], level: ['intermediate', 'advanced'], avoid_if: [] },
  { name: 'Lat pulldown', category: 'upper_pull', equipment: ['cable_machine', 'gym_access'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Assisted pull-up', category: 'upper_pull', equipment: ['pull_up_bar', 'resistance_bands'], level: ['intermediate'], avoid_if: ['shoulder_acute'] },
  { name: 'Pull-up / chin-up', category: 'upper_pull', equipment: ['pull_up_bar'], level: ['advanced'], avoid_if: ['shoulder_acute'] },

  // ── CORE / TRUNK ──
  { name: 'Dead bug', category: 'core', equipment: ['bodyweight'], level: ['beginner', 'intermediate'], avoid_if: ['recent_postpartum_under_6wk'] },
  { name: 'Bird dog', category: 'core', equipment: ['bodyweight'], level: ['beginner', 'intermediate'], avoid_if: [] },
  { name: 'Front plank', category: 'core', equipment: ['bodyweight'], level: ['beginner', 'intermediate'], avoid_if: ['diastasis_recti', 'recent_postpartum_under_6wk'] },
  { name: 'Side plank', category: 'core', equipment: ['bodyweight'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: ['shoulder_acute'] },
  { name: 'Hollow hold', category: 'core', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['diastasis_recti', 'lower_back_acute'] },
  { name: 'Pallof press', category: 'core', equipment: ['resistance_bands', 'cable_machine'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Suitcase carry', category: 'core', equipment: ['dumbbells', 'kettlebell'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },

  // ── ROTATIONAL ──
  { name: 'Med-ball rotational throw', category: 'rotational', equipment: ['gym_access'], level: ['intermediate', 'advanced'], avoid_if: ['lower_back_acute', 'pregnancy_2nd_3rd_trimester'] },
  { name: 'Cable woodchop', category: 'rotational', equipment: ['cable_machine', 'resistance_bands'], level: ['beginner', 'intermediate'], avoid_if: ['lower_back_acute'] },

  // ── PLYOMETRIC ──
  { name: 'Pogo hops', category: 'plyometric', equipment: ['bodyweight'], level: ['beginner', 'intermediate'], avoid_if: ['acute_ankle_injury'] },
  { name: 'Broad jump', category: 'plyometric', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain', 'recent_acl', 'pregnancy_any'] },
  { name: 'Box jump (low)', category: 'plyometric', equipment: ['box', 'bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain', 'recent_acl', 'pregnancy_any'] },
  { name: 'Lateral bound', category: 'plyometric', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain', 'recent_acl', 'pregnancy_any'] },
  { name: 'Depth jump', category: 'plyometric', equipment: ['box'], level: ['advanced'], avoid_if: ['acute_knee_pain', 'recent_acl', 'pregnancy_any'] },

  // ── SPRINT ──
  { name: 'Strider / build-up sprint', category: 'sprint', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['hamstring_acute', 'recent_postpartum_under_12wk'] },
  { name: 'Short sprint (10-30m)', category: 'sprint', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['hamstring_acute', 'recent_postpartum_under_12wk'] },

  // ── MOBILITY ──
  { name: '90/90 hip mobility', category: 'mobility', equipment: ['bodyweight'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Thoracic rotation drill', category: 'mobility', equipment: ['bodyweight'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Hip flexor stretch (kneeling)', category: 'mobility', equipment: ['bodyweight'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'World\'s greatest stretch', category: 'mobility', equipment: ['bodyweight'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },

  // ── CONDITIONING ──
  { name: 'Bike intervals', category: 'conditioning', equipment: ['gym_access'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: [] },
  { name: 'Row machine intervals', category: 'conditioning', equipment: ['gym_access'], level: ['beginner', 'intermediate', 'advanced'], avoid_if: ['lower_back_acute'] },
  { name: 'Walking (low-impact aerobic)', category: 'conditioning', equipment: ['bodyweight'], level: ['beginner', 'intermediate'], avoid_if: [] },
  { name: 'Repeated shuttle runs', category: 'conditioning', equipment: ['bodyweight'], level: ['intermediate', 'advanced'], avoid_if: ['acute_knee_pain', 'recent_postpartum_under_12wk'] },
];

const EQUIPMENT_ALIAS_MAP: Array<{ pattern: RegExp; tags: EquipmentTag[] }> = [
  { pattern: /bodyweight only|bodyweight/i, tags: ['bodyweight'] },
  { pattern: /home.*equipment|dumbbell|band|kettlebell/i, tags: ['bodyweight', 'dumbbells', 'kettlebell', 'resistance_bands'] },
  { pattern: /gym access|gym|full gym/i, tags: ['bodyweight', 'dumbbells', 'barbell', 'kettlebell', 'resistance_bands', 'pull_up_bar', 'box', 'gym_access', 'cable_machine'] },
];

export function expandEquipmentTags(equipmentInput: string[] | undefined): EquipmentTag[] {
  if (!equipmentInput?.length) return ['bodyweight'];
  const tags = new Set<EquipmentTag>(['bodyweight']);
  for (const entry of equipmentInput) {
    for (const { pattern, tags: aliasTags } of EQUIPMENT_ALIAS_MAP) {
      if (pattern.test(entry)) {
        aliasTags.forEach((t) => tags.add(t));
      }
    }
  }
  return Array.from(tags);
}

const LEVEL_ALIAS_MAP: Array<{ pattern: RegExp; level: ExperienceLevel }> = [
  { pattern: /beginner|less than 1 year/i, level: 'beginner' },
  { pattern: /intermediate|1-3 years/i, level: 'intermediate' },
  { pattern: /advanced|3\+ years|3 \+/i, level: 'advanced' },
];

export function normaliseLevel(input: string | undefined): ExperienceLevel {
  if (!input) return 'beginner';
  for (const { pattern, level } of LEVEL_ALIAS_MAP) {
    if (pattern.test(input)) return level;
  }
  return 'beginner';
}

// Map keywords in the client's injuries / medical fields to the
// avoid_if tags used on exercises.
const AVOID_IF_TRIGGERS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /acl/i, tag: 'recent_acl' },
  { pattern: /knee pain|patellar tendon/i, tag: 'acute_knee_pain' },
  { pattern: /hamstring/i, tag: 'hamstring_acute' },
  { pattern: /lower back|low back|lumbar/i, tag: 'lower_back_acute' },
  { pattern: /shoulder/i, tag: 'shoulder_acute' },
  { pattern: /wrist/i, tag: 'wrist_injury' },
  { pattern: /ankle/i, tag: 'acute_ankle_injury' },
  { pattern: /groin/i, tag: 'groin_acute' },
  { pattern: /diastasis|diastasis recti|abdominal separation/i, tag: 'diastasis_recti' },
  { pattern: /postpartum.*(6 ?wk|6 week|first 6)/i, tag: 'recent_postpartum_under_6wk' },
  { pattern: /postpartum.*(12 ?wk|12 week|three month|3 month)/i, tag: 'recent_postpartum_under_12wk' },
  { pattern: /pregnan/i, tag: 'pregnancy_any' },
];

export function detectAvoidIfTags(input: {
  injuries?: string;
  medicalConditions?: string;
  issuesWorries?: string;
  cycleStatus?: string;
  programTrack?: string;
}): string[] {
  const haystack = [
    input.injuries || '',
    input.medicalConditions || '',
    input.issuesWorries || '',
  ].join(' ');
  const tags = new Set<string>();
  for (const { pattern, tag } of AVOID_IF_TRIGGERS) {
    if (pattern.test(haystack)) tags.add(tag);
  }
  if (input.cycleStatus === 'pregnant_or_postpartum') {
    tags.add('pregnancy_any');
    tags.add('recent_postpartum_under_12wk');
  }
  if (input.programTrack === 'pregnancy') tags.add('pregnancy_any');
  if (input.programTrack === 'postpartum') tags.add('recent_postpartum_under_12wk');
  return Array.from(tags);
}

export function filterExercises(opts: {
  equipment: EquipmentTag[];
  level: ExperienceLevel;
  avoidIfTags: string[];
}): Exercise[] {
  return EXERCISES.filter((ex) => {
    // Equipment: client must have at least one of the equipment tags this exercise needs.
    const equipmentMatch = ex.equipment.some((tag) => opts.equipment.includes(tag));
    if (!equipmentMatch) return false;

    // Level: exercise must be appropriate for the client's level.
    if (!ex.level.includes(opts.level)) return false;

    // Contraindications: if any avoid_if tag for the exercise matches a client tag, exclude.
    if (ex.avoid_if.some((tag) => opts.avoidIfTags.includes(tag))) return false;

    return true;
  });
}
