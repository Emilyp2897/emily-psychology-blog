// Single source of truth for the two scheduled 12-month series.
//
// These lists define both the order posts appear in on their hub page and
// which posts count as part of the series. Several posts sit in the blog
// collection without being part of a series (standalone theory pieces, bonus
// toolkits), so "latest Training the Mind post" cannot simply be the newest
// post under that folder. The homepage and the hub pages both need the same
// answer, and keeping two copies of these lists has already caused one bug
// (the homepage referenced a toolkit slug that does not exist).

export type MonthEntry = {
  month: string;
  theme: string;
  slugs: string[];
};

export const trainingTheMindSeries: MonthEntry[] = [
  {
    month: 'Month 1',
    theme: 'Pressure & Performance Anxiety',
    slugs: [
      'training-the-mind/attention-control-theory',
      'training-the-mind/how-pressure-shows-in-ladies-football',
      'training-the-mind/choking-under-pressure',
    ],
  },
  {
    month: 'Month 2',
    theme: 'Confidence & Self-Talk',
    slugs: [
      'training-the-mind/understanding-confidence',
      'training-the-mind/applying-confidence-in-lgfa',
    ],
  },
  {
    month: 'Month 3',
    theme: 'Mistakes, Perfectionism & Shame',
    slugs: [
      'training-the-mind/understanding-mistakes-and-perfectionism',
      'training-the-mind/applying-mistake-resilience-in-lgfa',
    ],
  },
  {
    month: 'Month 4',
    theme: 'Team Culture, Belonging & Communication',
    slugs: [
      'training-the-mind/understanding-team-culture-and-belonging',
      'training-the-mind/applying-team-culture-in-lgfa',
    ],
  },
  {
    month: 'Month 5',
    theme: 'Motivation, Discipline & Burnout Risk',
    slugs: [
      'training-the-mind/understanding-motivation',
      'training-the-mind/applying-motivation-and-discipline-in-lgfa',
    ],
  },
  {
    month: 'Month 6',
    theme: 'Injury Psychology & Comeback Confidence',
    slugs: [
      'training-the-mind/understanding-identity-and-fear-after-injury',
      'training-the-mind/applying-comeback-confidence-in-lgfa',
    ],
  },
  {
    month: 'Month 7',
    theme: 'Flow, Focus & Playing Free',
    slugs: [
      'training-the-mind/understanding-flow-and-focus',
      'training-the-mind/applying-flow-and-focus-in-lgfa',
    ],
  },
  {
    month: 'Month 8',
    theme: 'Body Image, RED-S & Food Culture',
    slugs: [
      'training-the-mind/understanding-body-image-in-sport',
      'training-the-mind/applying-body-confidence-and-fuelling-in-lgfa',
    ],
  },
  {
    month: 'Month 9',
    theme: 'Boundaries, Coaches & People-Pleasing',
    slugs: [
      'training-the-mind/understanding-why-women-athletes-over-accommodate',
      'training-the-mind/applying-boundaries-in-lgfa',
    ],
  },
  {
    month: 'Month 10',
    theme: 'Championship Pressure & Fear of Failure',
    slugs: [
      'training-the-mind/understanding-pressure-and-fear-of-failure',
      'training-the-mind/applying-championship-pressure-in-lgfa',
    ],
  },
  {
    month: 'Month 11',
    theme: 'Identity Beyond Sport & Balance',
    slugs: [
      'training-the-mind/understanding-athletic-identity',
      'training-the-mind/applying-balanced-identity-in-lgfa',
    ],
  },
  {
    month: 'Month 12',
    theme: 'Off-Season Mental Health & Reset',
    slugs: [
      'training-the-mind/understanding-off-season-mental-health',
      'training-the-mind/applying-off-season-recovery-in-lgfa',
    ],
  },
];

export type ToolkitMonth = {
  month: string;
  theme: string;
  slug: string;
};

// Each month of Training the Mind has one companion toolkit.
export const gaelPerformanceToolkitSeries: ToolkitMonth[] = [
  { month: 'Month 1',  theme: 'Pressure & Performance Anxiety',         slug: 'gael-performance-toolkit/pre-performance-routines-toolkit' },
  { month: 'Month 2',  theme: 'Confidence & Self-Talk',                  slug: 'gael-performance-toolkit/self-talk-and-confidence-toolkit' },
  { month: 'Month 3',  theme: 'Mistakes, Perfectionism & Shame',          slug: 'gael-performance-toolkit/mistake-reset-toolkit' },
  { month: 'Month 4',  theme: 'Team Culture, Belonging & Communication',  slug: 'gael-performance-toolkit/team-communication-toolkit' },
  { month: 'Month 5',  theme: 'Motivation, Discipline & Burnout Risk',    slug: 'gael-performance-toolkit/goal-setting-toolkit' },
  { month: 'Month 6',  theme: 'Injury Psychology & Comeback Confidence',  slug: 'gael-performance-toolkit/imagery-and-graded-exposure-toolkit' },
  { month: 'Month 7',  theme: 'Flow, Focus & Playing Free',               slug: 'gael-performance-toolkit/focus-and-refocus-toolkit' },
  { month: 'Month 8',  theme: 'Body Image, RED-S & Food Culture',         slug: 'gael-performance-toolkit/nutrition-and-language-toolkit' },
  { month: 'Month 9',  theme: 'Boundaries, Coaches & People-Pleasing',    slug: 'gael-performance-toolkit/boundaries-and-assertiveness-toolkit' },
  { month: 'Month 10', theme: 'Championship Pressure & Fear of Failure',  slug: 'gael-performance-toolkit/championship-routines-toolkit' },
  { month: 'Month 11', theme: 'Identity Beyond Sport & Balance',          slug: 'gael-performance-toolkit/values-and-balance-toolkit' },
  { month: 'Month 12', theme: 'Off-Season Mental Health & Reset',         slug: 'gael-performance-toolkit/off-season-recovery-toolkit' },
];

export const trainingTheMindSlugs = trainingTheMindSeries.flatMap((entry) => entry.slugs);

export const gaelPerformanceToolkitSlugs = gaelPerformanceToolkitSeries.map((entry) => entry.slug);

/**
 * Champo Week: the championship-relevant content, pulled from every series at
 * once. Driven by the "championship" tag in each post's frontmatter rather
 * than a hardcoded list, so tagging a new post is all it takes to surface it
 * on the homepage and in the content hub.
 *
 * London championship runs from the end of July, pauses through August, then
 * runs September to December depending how far you go. Championship content
 * should be scheduled to land at the end of July.
 */
export const CHAMPO_TAG = 'championship';

/** Friendly series labels, for badging content that spans several series. */
export const seriesLabels: Record<string, string> = {
  'training-the-mind': 'Training the Mind',
  'gael-performance-toolkit': 'Toolkit',
  'strong-minds-stronger-players': 'Mental Health',
  'mindfulness-and-affirmations': 'Mindfulness',
};

export const seriesHubHref: Record<string, string> = {
  'training-the-mind': '/content-hub/training-the-mind/',
  'gael-performance-toolkit': '/content-hub/gael-performance-toolkit/',
  'strong-minds-stronger-players': '/content-hub/strong-minds-stronger-players/',
  'mindfulness-and-affirmations': '/content-hub/mindfulness-and-affirmations/',
};
