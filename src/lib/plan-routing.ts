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
// Standard plans are autonomous. They generate and go straight to the
// customer with no review step, and the plan itself carries the AI notice
// telling the reader it was machine-generated and how to get in touch if
// something in it looks wrong.
//
//   PLAN_DESTINATION_STANDARD=client  (autonomous, current default)
//   PLAN_DESTINATION_STANDARD=emily   (puts every standard plan back in the
//                                      review queue, if that is ever needed)
//
// Specialised tracks (pregnancy / postpartum / endometriosis /
// return-to-play) and clinical-pause red flags ALWAYS route to Emily,
// regardless of the env var. This is hard-coded per Emily's decision and the
// env var cannot switch it off.
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
  // Astro server-side reads from import.meta.env. Defaults to 'client':
  // standard plans send themselves. The default lives here rather than in the
  // Vercel environment so the behaviour is the same locally, in preview and in
  // production, and so it cannot be changed by accident from a dashboard.
  // Set PLAN_DESTINATION_STANDARD=emily to put standard plans back in review.
  const raw = (import.meta.env.PLAN_DESTINATION_STANDARD as string | undefined) || 'client';
  if (raw === 'emily') return 'emily';
  return 'client';
}
