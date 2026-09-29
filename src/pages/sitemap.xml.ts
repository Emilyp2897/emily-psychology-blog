/**
 * The site's sitemap, built on demand.
 *
 * @astrojs/sitemap is a dependency but was never registered, which is why
 * /sitemap-index.xml 404'd on every page. Registering it would not have
 * fixed much: the integration can only enumerate prerendered routes, and the
 * homepage, all four content hubs and every article are `prerender = false`.
 * It would have produced a sitemap of the legal and pricing pages with none
 * of the content on it.
 *
 * Building it here instead buys the thing that matters most: the list is
 * assembled per request, so an article entering the sitemap happens on its
 * release date rather than at the next deploy. That is the same reason the
 * hub pages are on demand.
 *
 * Only pages worth landing on from a search result are listed. Redirects,
 * account pages, forms and anything token-gated are left out on purpose;
 * see EXCLUDED below for the reasoning.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { CHAT_ENABLED } from '../lib/chat-enabled';
import { isReleased } from '../data/release';
import { workbookIsReleased, workbooks } from '../data/workbooks';

/**
 * Public pages with no release date of their own. Hub and series pages are
 * included here even though they render on demand, because a sitemap built
 * from prerendered routes alone would miss them.
 */
const STATIC_PAGES = [
  '/',
  '/about/',
  '/ai-policy/',
  '/books-and-podcasts/',
  '/coaches/',
  '/contact-us/',
  '/content-hub/',
  '/content-hub/training-the-mind/',
  '/content-hub/gael-performance-toolkit/',
  '/content-hub/strong-minds-stronger-players/',
  '/content-hub/mindfulness-and-affirmations/',
  '/personal-training/',
  '/pricing/',
  '/privacy/',
  '/resources/',
  '/terms/',
  '/workshops/',
];

/**
 * Deliberately absent, so nobody adds them back wondering why:
 *
 *  - /blog/* and /gael-performance-toolkit  301 redirects to /content-hub/*.
 *    A sitemap lists destinations, never the redirect that points at them.
 *  - /admin/*                               private.
 *  - /login, /signup, /dashboard            account pages, nothing to index.
 *  - /success, /cancel, /programme-success,
 *    /programme-preview                     mid-checkout states.
 *  - /coach-intake, /content-feedback       forms, not destinations.
 *  - /plan/*, /team-plan/*                  token-gated and per-customer.
 */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function urlEntry(origin: string, path: string, lastmod?: Date): string {
  const loc = xmlEscape(new URL(path, origin).href);
  const stamp = lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
  return `  <url>\n    <loc>${loc}</loc>${stamp}\n  </url>`;
}

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL('https://mindthegael.co.uk')).origin;

  const posts = await getCollection('blog');
  const entries: string[] = STATIC_PAGES.map((path) => urlEntry(origin, path));

  // /chat is only a page when Saoirse is switched on. With the chat off, which
  // is the default, it 302s to /resources, and a sitemap should list the
  // destination rather than the redirect pointing at it.
  if (CHAT_ENABLED) entries.push(urlEntry(origin, '/chat/'));

  // Only released articles. Listing a held or future-dated one would send a
  // crawler at the 404 its own lock returns, which is worse than omitting it.
  for (const post of posts) {
    const segments = post.slug.split('/');
    if (segments.length < 2) continue; // top-level series index, not an article
    // A file named after its own folder (gael-performance-toolkit/
    // gael-performance-toolkit.md) is a series landing file with an empty
    // body. Its URL duplicates the hub page, so listing it would put thin
    // duplicate content in front of a crawler.
    if (segments[segments.length - 1] === segments[segments.length - 2]) continue;
    if (!isReleased(post)) continue;
    entries.push(
      urlEntry(origin, `/content-hub/${post.slug}/`, post.data.updatedDate ?? post.data.pubDate)
    );
  }

  for (const workbook of workbooks) {
    if (!workbookIsReleased(workbook)) continue;
    entries.push(urlEntry(origin, `/workbooks/${workbook.slug}.html`, workbook.pubDate));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // An hour is long enough to absorb crawler traffic and short enough
      // that a release on its day is picked up without a deploy.
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
