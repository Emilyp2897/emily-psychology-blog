/**
 * Serves a workbook, but only once its release date has passed.
 *
 * This route is the reason the workbook HTML lives in src/ rather than
 * public/. A file in public/ is served by the host no matter what the site
 * links to, so removing a link hides a workbook without locking it. Here the
 * date is checked before a single byte goes out.
 *
 * On-demand rather than prerendered, so a workbook unlocks itself on its date
 * without waiting for the next deploy.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { findWorkbook, workbookIsReleased } from '../../data/workbooks';

import mentalHealthWorkbook from '../../workbooks/mental-health-workbook.html?raw';

// Imported statically so the HTML is bundled with the function. A dynamic
// read from disk would work locally and then fail on Vercel, where the source
// tree is not part of the deployed function.
const sources: Record<string, string> = {
  'mental-health-workbook': mentalHealthWorkbook,
};

export const GET: APIRoute = ({ params }) => {
  // The URL keeps the .html suffix the workbook had in public/, so links
  // already shared outside the site survive the move.
  const slug = (params.slug ?? '').replace(/\.html$/, '');
  const workbook = findWorkbook(slug);
  const html = sources[slug];

  // One response for "no such workbook" and for "not out yet", so a locked
  // workbook gives nothing away about existing before its release date.
  if (!workbook || !html || !workbookIsReleased(workbook)) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Not cached, or a 404 taken the day before release could be replayed
      // to readers after it, and the lock would outlive its own date.
      'Cache-Control': 'no-store',
    },
  });
};
