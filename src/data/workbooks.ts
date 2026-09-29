/**
 * Workbooks are printable documents rather than blog posts, so they sit
 * outside the content collection and have no frontmatter to carry a release
 * date. They still need the same scheduled release the articles get, which is
 * why the dates live here and why both the homepage and the Mindfulness hub
 * read them from this one file instead of hardcoding a link each.
 *
 * The HTML itself lives in src/workbooks/, deliberately NOT in public/.
 * Everything in public/ is copied to the built site verbatim and served
 * whatever the pages link, so a workbook sitting there is readable by URL on
 * day one. src/pages/workbooks/[slug].ts serves the file only once its date
 * has passed, which is what makes the lock real rather than cosmetic.
 *
 * To add a workbook: drop its HTML in src/workbooks/, register the filename
 * in the route's `sources` map, and add an entry here. A workbook with no
 * pubDate is one that hasn't been written yet, and renders as a coming-soon
 * tile with no link.
 */
import { isReleased, lockLabel, type ReleasePost } from './release';

export type Workbook = {
  /** Also the filename in src/workbooks/, minus the extension. */
  slug: string;
  title: string;
  description?: string;
  pages?: string;
  /** When it becomes readable. Absent means it isn't written yet. */
  pubDate?: Date;
};

export const workbooks: Workbook[] = [
  {
    slug: 'mental-health-workbook',
    title: 'Mental Health Workbook',
    description: 'Breathing, grounding, thought logs, sleep and mood tracking, goals.',
    pages: '43 pages, print at home',
    pubDate: new Date('2026-10-06T00:00:00Z'),
  },
  {
    slug: 'mindfulness-workbook-for-athletes',
    title: 'The Mindfulness Workbook for Athletes',
  },
];

/**
 * Shapes a workbook like a post so the article release rules apply unchanged.
 * Returns null for a workbook with no date, which can never be released.
 */
function asReleasePost(workbook: Workbook): ReleasePost | null {
  return workbook.pubDate ? { data: { pubDate: workbook.pubDate } } : null;
}

/** True when the workbook is readable now. */
export function workbookIsReleased(workbook: Workbook, today?: Date): boolean {
  const post = asReleasePost(workbook);
  return post ? isReleased(post, today) : false;
}

/**
 * The URL to read it at, or undefined while it is locked. Keeps the .html
 * suffix the workbook had while it lived in public/, so links already shared
 * outside the site carry on working once it releases.
 */
export function workbookHref(workbook: Workbook, today?: Date): string | undefined {
  return workbookIsReleased(workbook, today) ? `/workbooks/${workbook.slug}.html` : undefined;
}

/** What a locked tile should say: the release date, or "Coming soon". */
export function workbookLockLabel(workbook: Workbook): string {
  const post = asReleasePost(workbook);
  return post ? lockLabel(post) : 'Coming soon';
}

export function findWorkbook(slug: string): Workbook | undefined {
  return workbooks.find((workbook) => workbook.slug === slug);
}
