import type { SportProfile } from './types';

// ────────────────────────────────────────────────────────────────────
// NOTE FOR EMILY (PLEASE VALIDATE BEFORE GOING LIVE):
//
// These sport profiles are descriptive starters compiled from widely
// accepted S&C principles, sport governing-body coaching guidance, and
// standard injury-epidemiology data. They are designed to give the
// training-plan model a sport-specific anchor — not to replace your own
// expertise.
//
// Please review each profile, correct anything you would change, and
// add citations to specific frameworks or papers you trust.
//
// Frameworks I drew on when writing these:
// - NSCA Essentials of Strength Training and Conditioning (4th ed.)
// - Long-Term Athlete Development model (Balyi, Way, Higgs)
// - UKSCA position statements
// - GAA / LGFA / Camogie Association coaching guidance
// - World Rugby and FA Women's strength & conditioning resources
// ────────────────────────────────────────────────────────────────────

export const SPORT_PROFILES: SportProfile[] = [
  {
    name: 'Ladies Gaelic Football',
    aliases: ['lgfa', 'ladies football', 'ladies gaelic', 'gaa ladies'],
    energy_system: 'mixed_field',
    primary_demands: [
      'repeated sprint ability',
      'change of direction',
      'aerobic base',
      'jumping and catching',
      'tackling absorption',
    ],
    power_emphasis: 'high',
    contact_load: 'moderate',
    injury_hotspots: ['ACL', 'hamstring', 'ankle', 'concussion'],
    programming_notes:
      'Posterior chain strength, single-leg stability, and ACL-protective work are priorities. Repeat-sprint conditioning is more relevant than long steady-state running. Build acceleration and deceleration mechanics into weekly programming.',
  },
  {
    name: 'Camogie',
    aliases: ['camog'],
    energy_system: 'mixed_field',
    primary_demands: [
      'repeated sprint ability',
      'rotational power',
      'change of direction',
      'aerobic base',
      'overhead striking strength',
    ],
    power_emphasis: 'high',
    contact_load: 'moderate',
    injury_hotspots: ['ACL', 'hamstring', 'wrist', 'concussion'],
    programming_notes:
      'Similar to LGFA but with added rotational power demands and overhead striking patterns. Include thoracic mobility, rotational core work (med-ball throws, cable rotations), and wrist/forearm conditioning.',
  },
  {
    name: "Women's Soccer",
    aliases: ['soccer', 'football', 'womens football', 'ladies soccer'],
    energy_system: 'mixed_field',
    primary_demands: [
      'repeated sprint ability',
      'change of direction',
      'aerobic base',
      'single-leg power',
    ],
    power_emphasis: 'high',
    contact_load: 'moderate',
    injury_hotspots: ['ACL', 'hamstring', 'ankle', 'hip flexor'],
    programming_notes:
      "Women's soccer has a high ACL injury rate. Prioritise neuromuscular control, single-leg landing mechanics, hamstring eccentric strength (e.g. Nordic curls), and posterior chain.",
  },
  {
    name: "Women's Rugby",
    aliases: ['rugby', 'rugby union', 'rugby league', 'ladies rugby'],
    energy_system: 'mixed_field',
    primary_demands: [
      'maximal strength',
      'repeated power output',
      'contact absorption',
      'aerobic base',
      'tackling mechanics',
    ],
    power_emphasis: 'high',
    contact_load: 'high',
    injury_hotspots: ['ACL', 'shoulder', 'neck', 'concussion', 'ankle'],
    programming_notes:
      'Heavy emphasis on absolute strength, posterior chain, neck/upper back conditioning, and contact-absorption work. Plyometric and collision-readiness programming is essential pre-season.',
  },
  {
    name: 'Field Hockey',
    aliases: ['hockey'],
    energy_system: 'mixed_field',
    primary_demands: [
      'repeated sprint ability',
      'low athletic stance (sustained hip flexion)',
      'change of direction',
      'aerobic base',
    ],
    power_emphasis: 'moderate',
    contact_load: 'low',
    injury_hotspots: ['lower back', 'hamstring', 'ankle', 'hip flexor'],
    programming_notes:
      'Sustained low-stance posture loads the lower back and hip flexors. Build hip mobility, anti-extension core, and posterior chain strength to counter the position.',
  },
  {
    name: 'Netball',
    aliases: [],
    energy_system: 'court_intermittent',
    primary_demands: [
      'jumping and landing',
      'change of direction',
      'sustained athletic stance',
      'repeated short efforts',
    ],
    power_emphasis: 'high',
    contact_load: 'low',
    injury_hotspots: ['ACL', 'ankle', 'knee'],
    programming_notes:
      'Very high ACL and ankle injury rates due to repeated jump-land-pivot patterns. Prioritise landing mechanics, single-leg control, ankle strength, and decelerative capacity.',
  },
  {
    name: 'Basketball',
    aliases: [],
    energy_system: 'court_intermittent',
    primary_demands: [
      'repeated jumping',
      'change of direction',
      'short sprint capacity',
      'rebounding strength',
    ],
    power_emphasis: 'high',
    contact_load: 'moderate',
    injury_hotspots: ['ankle', 'ACL', 'patellar tendon'],
    programming_notes:
      'Plyometric work needs careful volume management to protect patellar tendons. Include single-leg deceleration, ankle strength, and posterior chain work.',
  },
  {
    name: 'Sprint Athletics',
    aliases: ['sprint', 'sprinting', '100m', '200m', '400m', 'sprinter'],
    energy_system: 'power_dominant',
    primary_demands: [
      'maximal sprint power',
      'starting acceleration',
      'top-end speed maintenance',
      'horizontal force production',
    ],
    power_emphasis: 'high',
    contact_load: 'none',
    injury_hotspots: ['hamstring', 'achilles', 'lower back'],
    programming_notes:
      'Heavy posterior chain bias, eccentric hamstring loading (Nordic curls, RDLs), and high-quality short sprint work. Recovery between sprints is non-negotiable.',
  },
  {
    name: 'Middle-Distance Athletics',
    aliases: ['middle distance', '800m', '1500m', 'mile'],
    energy_system: 'mixed_field',
    primary_demands: [
      'aerobic capacity',
      'lactate tolerance',
      'running economy',
      'late-race power',
    ],
    power_emphasis: 'moderate',
    contact_load: 'none',
    injury_hotspots: ['hamstring', 'achilles', 'shin', 'iliotibial band'],
    programming_notes:
      'Strength work supports running economy and injury resilience without adding mass. Focus on hip and trunk stability, calf/achilles conditioning, and posterior chain.',
  },
  {
    name: 'Distance Athletics',
    aliases: ['distance', 'long distance', '5k', '10k', 'half marathon', 'marathon', 'runner'],
    energy_system: 'sustained_aerobic',
    primary_demands: [
      'aerobic capacity',
      'running economy',
      'tendon stiffness',
      'fatigue resistance',
    ],
    power_emphasis: 'low',
    contact_load: 'none',
    injury_hotspots: ['shin', 'achilles', 'plantar fascia', 'IT band', 'lower back'],
    programming_notes:
      'Distance runners benefit from heavy strength (2x/week) more than is commonly believed. Prioritise calf conditioning, hip stability, and posterior chain. Be cautious of cumulative load with concurrent running mileage.',
  },
  {
    name: 'Tennis',
    aliases: [],
    energy_system: 'court_intermittent',
    primary_demands: [
      'rotational power',
      'lateral and multi-directional movement',
      'shoulder stability',
      'repeated short efforts',
    ],
    power_emphasis: 'high',
    contact_load: 'none',
    injury_hotspots: ['shoulder', 'lower back', 'wrist', 'ankle'],
    programming_notes:
      'Build rotational power and shoulder stability. Protect the lower back with anti-extension and anti-rotation core work given the serve pattern.',
  },
  {
    name: 'Skiing',
    aliases: ['ski', 'alpine skiing', 'downhill skiing', 'skier', 'snowboard', 'snowboarding'],
    energy_system: 'power_dominant',
    primary_demands: [
      'eccentric quad strength',
      'isometric strength in athletic stance',
      'lateral hip and knee stability',
      'core stability under unstable conditions',
      'anaerobic capacity over 30-90 second efforts',
    ],
    power_emphasis: 'high',
    contact_load: 'low',
    injury_hotspots: ['ACL', 'MCL', 'thumb (skier\'s thumb)', 'lower back', 'shoulder'],
    programming_notes:
      'Skiing has one of the highest ACL injury rates in sport. Prioritise heavy eccentric quad loading (slow-tempo squats, single-leg eccentric step-downs), lateral hip and knee stability, core anti-rotation, and isometric holds in athletic stance. Build pre-season conditioning that mimics 30-90 second high-intensity efforts with short rest. Landing mechanics and decelerative capacity matter for off-piste or freestyle. If the client does cross-country specifically, shift to a more aerobic profile, close to distance athletics.',
  },
  {
    name: 'General Female Athlete (fallback)',
    aliases: ['general', 'fallback', 'other'],
    energy_system: 'mixed_field',
    primary_demands: [
      'general athletic strength',
      'aerobic base',
      'movement quality',
      'injury resilience',
    ],
    power_emphasis: 'moderate',
    contact_load: 'low',
    injury_hotspots: ['ACL', 'lower back', 'shoulder'],
    programming_notes:
      'Default well-rounded programming: balanced strength, posterior chain priority, single-leg work, mobility, and progressive aerobic conditioning. Use this fallback when the listed sport does not match the known profiles.',
  },
];

export function findSportProfile(input: string): SportProfile {
  const normalized = (input || '').toLowerCase().trim();
  if (!normalized) {
    return SPORT_PROFILES[SPORT_PROFILES.length - 1];
  }

  for (const profile of SPORT_PROFILES) {
    if (profile.name.toLowerCase() === normalized) return profile;
  }

  for (const profile of SPORT_PROFILES) {
    if (
      profile.aliases.some(
        (a) => normalized === a.toLowerCase() || normalized.includes(a.toLowerCase())
      )
    ) {
      return profile;
    }
  }

  // Last resort: substring match against the canonical name
  for (const profile of SPORT_PROFILES) {
    if (normalized.includes(profile.name.toLowerCase())) return profile;
  }

  return SPORT_PROFILES[SPORT_PROFILES.length - 1];
}
