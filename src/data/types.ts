// Shared types for the training plan system.
// Owned by training-plan.ts; consumed by sport-profiles, exercises,
// red-flags, program-tracks, and plan-routing.

export interface ConsultationWithPlanRequest {
  // Contact + basic info
  name: string;
  email: string;
  phone?: string;
  sport: string;
  // Legacy fields kept optional for backwards compatibility with older
  // form submissions; the current intake form does not collect these.
  contactMethod?: string;
  preferredTime?: string;
  goals: string;
  includeProgressionPlan: boolean;

  // Physical / training context
  age?: number;
  height?: string;
  weight?: string;
  exerciseLevel?: string;
  sportsOrNot?: string;
  equipment?: string[];
  // The athlete's current weekly activity level (band). Captures where
  // they are right now, regardless of what their schedule allows.
  currentActivityLevel?: string;
  // The number of sessions per week the athlete can realistically commit
  // to. This is what shapes the plan structure (vs. currentActivityLevel
  // which informs starting load).
  frequencyPerWeek?: number;
  planDuration?: string;
  planGoals?: string[];
  issuesWorries?: string;
  lifestyle?: string;
  medicalConditions?: string;
  injuries?: string;

  // Mind the Gael specific fields
  programTrack?: ProgramTrackId;
  cycleStatus?: CycleStatus;
  anythingElse?: string;
  currentWeek?: string;

  // Stripe checkout session ID, present only when the user reached the
  // intake form after a successful programme purchase. Used to verify
  // payment before generating an autonomous plan.
  sessionId?: string;

  // Plan type — physical training plan vs mental performance plan.
  // Defaults to 'physical' for backwards compatibility with intakes
  // submitted before mental plans existed.
  planType?: 'physical' | 'mental';

  // Mental performance plan specific fields (only present when
  // planType === 'mental'). Captured by the dedicated mental intake form.
  competitionLevel?: string;             // e.g. "Club", "County", "Inter-county"
  yearsCompeting?: string;
  performanceMomentsToWorkOn?: string[]; // multi-select tags
  currentRoutines?: string;              // free text
  peakMoment?: string;                   // free text
  struggleMoment?: string;               // free text
  confidenceLevel?: string;              // 1-10

  // Cross-plan companion summary. Optional free text the client provides
  // when they already have (or are planning to do) the OTHER Mind the
  // Gael plan. On a physical intake this describes their mental plan; on
  // a mental intake it describes their physical plan. Fed into the prompt
  // so the new plan can reference and reinforce the existing one.
  companionPlanSummary?: string;

  // Where in the season this plan is for. Drives plan structure: pre-season
  // builds a base, championship lead-up peaks and tapers, etc. Optional
  // (defaults to general/no specific phase) but improves plan relevance.
  seasonPhase?: 'pre_season' | 'championship_leadup' | 'in_season' | 'off_season' | '';

  // Existing club / sport training load. Critical for the physical plan
  // generator: an athlete doing 2 club trainings + a match per week is
  // already at ~3 sessions of sport-specific load before the plan adds
  // anything. The generator uses this to manage total weekly load and to
  // schedule lighter sessions on day-after-match. Useful for the mental
  // plan too (pre-match routines apply differently when matches > 0).
  clubTrainingsPerWeek?: '0' | '1' | '2' | '3' | '4+' | '';
  matchesPerWeek?: '0' | '1' | '2' | 'variable' | '';

  // Which days of the week the athlete trains with their sport (e.g.
  // ['mon', 'wed']). Lets the plan generator schedule physical sessions
  // around club nights and place mental routines on match days.
  trainingDays?: string[];

  // Whether the athlete is currently training with their sport right
  // now (independent of seasonPhase, which is about the calendar).
  // Critical for intensity calibration: someone "actively competing"
  // needs a different plan to someone "not currently training", even
  // if both ticked the same seasonPhase.
  activeTrainingStatus?:
    | 'actively_competing'
    | 'training_not_competing'
    | 'building_back_up'
    | 'not_training'
    | '';
}

export type ProgramTrackId =
  | 'standard'
  | 'pregnancy'
  | 'postpartum'
  | 'endometriosis'
  | 'return_to_play';

export type CycleStatus =
  | 'cycling_regularly'
  | 'hormonal_contraception'
  | 'irregular_or_not_tracking'
  | 'pregnant_or_postpartum'
  | 'perimenopausal'
  | 'prefer_not_to_say';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export type EquipmentTag =
  | 'bodyweight'
  | 'dumbbells'
  | 'barbell'
  | 'kettlebell'
  | 'resistance_bands'
  | 'pull_up_bar'
  | 'box'
  | 'gym_access'
  | 'cable_machine';

export type SportProfile = {
  name: string;
  aliases: string[];
  energy_system:
    | 'mixed_field'
    | 'sustained_aerobic'
    | 'power_dominant'
    | 'court_intermittent';
  primary_demands: string[];
  power_emphasis: 'high' | 'moderate' | 'low';
  contact_load: 'high' | 'moderate' | 'low' | 'none';
  injury_hotspots: string[];
  programming_notes: string;
};

export type Exercise = {
  name: string;
  category:
    | 'squat'
    | 'hinge'
    | 'lunge'
    | 'upper_push'
    | 'upper_pull'
    | 'core'
    | 'rotational'
    | 'plyometric'
    | 'sprint'
    | 'mobility'
    | 'conditioning';
  equipment: EquipmentTag[];
  level: ExperienceLevel[];
  avoid_if: string[];
  notes?: string;
};

export type RedFlag = {
  id: string;
  detect: (input: ConsultationWithPlanRequest) => boolean;
  reason: string;
  clientMessage?: string;
};

export type ProgramTrack = {
  id: ProgramTrackId;
  name: string;
  detect: (input: ConsultationWithPlanRequest) => boolean;
  protocol: string;
  citations: string[];
};

export type PlanDestination = 'emily' | 'client';

export type RoutingDecision = {
  destination: PlanDestination;
  shouldGeneratePlan: boolean;
  reason: string;
  flagLabel: string | null;
};
