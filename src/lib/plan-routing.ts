import type {
  PlanDestination,
  ProgramTrackId,
  RedFlag,
  RoutingDecision,
} from '../data/types';

// ────────────────────────────────────────────────────────────────────
// Plan-routing decision logic.
//
// This is the SINGLE place that decides:
//   1. Whether a training plan should be generated at all
//   2. Where the plan/notification should be sent (Emily vs client)
//
// v1 -> v2 flip is a single env var change:
//   PLAN_DESTINATION_STANDARD=emily   (v1, current default)
//   PLAN_DESTINATION_STANDARD=client  (v2, autonomous)
//
// Specialised tracks (pregnancy / postpartum / endometriosis /
// return-to-play) and clinical-pause red flags ALWAYS route to Emily,
// regardless of the env var. This is hard-coded per Emily's decision.
// ────────────────────────────────────────────────────────────────────

export function decideRouting(input: {
  redFlags: RedFlag[];
  track: ProgramTrackId;
}): RoutingDecision {
  // 1. Any red flag pauses plan generation and routes to Emily.
  if (input.redFlags.length > 0) {
    const isCrisis = input.redFlags.some((f) => f.id === 'mental_health_crisis');
    return {
      destination: 'emily',
      shouldGeneratePlan: false,
      reason: `Clinical pause: ${input.redFlags.map((f) => f.id).join(', ')}`,
      flagLabel: isCrisis ? '🚨 CRISIS FLAG' : '⚠ CLINICAL PAUSE',
    };
  }

  // 2. Any of the four specialised tracks always routes to Emily.
  if (input.track !== 'standard') {
    return {
      destination: 'emily',
      shouldGeneratePlan: true,
      reason: `Specialised track: ${input.track}`,
      flagLabel: `🩺 SPECIALISED TRACK: ${input.track.toUpperCase()}`,
    };
  }

  // 3. Standard plan — env var controls destination.
  const standardDestination = readStandardDestination();
  return {
    destination: standardDestination,
    shouldGeneratePlan: true,
    reason: standardDestination === 'client' ? 'Standard plan (autonomous v2)' : 'Standard plan (review v1)',
    flagLabel: null,
  };
}

function readStandardDestination(): PlanDestination {
  // Astro server-side reads from import.meta.env. Defaults to 'emily' if
  // unset — v1 behaviour. To enable v2 autonomous mode for standard plans,
  // set PLAN_DESTINATION_STANDARD=client in the Vercel environment.
  const raw = (import.meta.env.PLAN_DESTINATION_STANDARD as string | undefined) || 'emily';
  if (raw === 'client') return 'client';
  return 'emily';
}
