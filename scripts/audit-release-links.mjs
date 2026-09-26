/**
 * Checks that nothing readable links to something that is not readable yet.
 *
 * An article going live can quietly break the release schedule: it is live,
 * but the pieces it points at are still held or dated in the future, so a
 * reader following the link lands on the "not out yet" gate. That is the
 * failure this catches.
 *
 * It walks two directions:
 *   1. Released articles -> any content-hub link that is still locked.
 *   2. Pages, layouts and components -> the same, for hardcoded links that
 *      bypass the release gate in the content collection.
 *
 * Release state matches src/data/release.ts: an article is locked by a
 * future pubDate or by `hold: true`.
 *
 * Usage:
 *   node scripts/audit-release-links.mjs              # as of today
 *   node scripts/audit-release-links.mjs 2026-09-27   # as of a release date
 *
 * Exits 1 when anything dangles, so it can gate a release.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BLOG_ROOT = 'src/content/blog';
const SRC_ROOT = 'src';

// The four series hubs are real pages, not collection entries, so a link to
// one is always valid and must not be reported as missing.
const SERIES_HUBS = new Set([
  'training-the-mind',
  'gael-performance-toolkit',
  'strong-minds-stronger-players',
  'mindfulness-and-affirmations',
]);

const asOf = process.argv[2] ? new Date(`${process.argv[2]}T00:00:00Z`) : new Date();
asOf.setUTCHours(0, 0, 0, 0);

function walk(dir, test) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path, test));
    else if (test(path)) found.push(path);
  }
  return found;
}

/** slug -> release state, for every article in the collection. */
const articles = new Map();
for (const path of walk(BLOG_ROOT, (p) => p.endsWith('.md'))) {
  const source = readFileSync(path, 'utf8');
  const pubDate = source.match(/^pubDate:\s*['"]?([0-9-]+)/m)?.[1];
  articles.set(path.replace(`${BLOG_ROOT}/`, '').replace(/\.md$/, ''), {
    path,
    source,
    pubDate: pubDate ? new Date(`${pubDate}T00:00:00Z`) : null,
    hold: /^hold:\s*true/m.test(source),
  });
}

const isReleased = (slug) => {
  const article = articles.get(slug);
  return Boolean(article && !article.hold && article.pubDate && article.pubDate <= asOf);
};

/** Why a link target is not readable, or null when it is fine. */
function lockReason(href) {
  const slug = href.replace(/^\/content-hub\//, '').replace(/\/$/, '');
  if (!slug || SERIES_HUBS.has(slug)) return null;
  const article = articles.get(slug);
  if (!article) return 'no such article';
  if (isReleased(slug)) return null;
  if (article.hold) return 'held';
  if (!article.pubDate) return 'no pubDate';
  return `releases ${article.pubDate.toISOString().slice(0, 10)}`;
}

const problems = [];

function check(label, source, pattern) {
  for (const href of new Set([...source.matchAll(pattern)].map((m) => m[1]))) {
    const reason = lockReason(href);
    if (reason) problems.push({ label, href, reason });
  }
}

// 1. Released articles, via markdown link syntax.
for (const [slug, article] of articles) {
  if (!isReleased(slug)) continue;
  check(article.path, article.source, /\]\((\/content-hub\/[^)#\s]+)/g);
}

// 2. Everything else in src, via any quoted or parenthesised href.
for (const path of walk(SRC_ROOT, (p) => /\.(astro|ts|tsx|js|mjs)$/.test(p))) {
  if (path.startsWith(BLOG_ROOT)) continue;
  check(path, readFileSync(path, 'utf8'), /["'(](\/content-hub\/[a-z0-9\-/]+)/g);
}

const released = [...articles.keys()].filter(isReleased).length;
console.log(`As of ${asOf.toISOString().slice(0, 10)}: ${released} of ${articles.size} articles released.\n`);

if (problems.length === 0) {
  console.log('No released content links to anything still locked.');
  process.exit(0);
}

let current = null;
for (const { label, href, reason } of problems) {
  if (label !== current) {
    console.log(label);
    current = label;
  }
  console.log(`   -> ${href}   [${reason}]`);
}
console.log(`\n${problems.length} dangling reference${problems.length === 1 ? '' : 's'}.`);
process.exit(1);
