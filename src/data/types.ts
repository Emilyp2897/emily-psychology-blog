// Shared types for the training plan system.
// Owned by training-plan.ts; consumed by sport-profiles, exercises,
// red-flags, program-tracks, and plan-routing.

export interface ConsultationWithPlanRequest {
  // Contact + basic info
  name: string;
  email: string;
  phone?: string;
  sport: string;
  contactMethod: string;
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
