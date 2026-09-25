// TEMPORARY diagnostic. Delete once the 404 is understood.
import { getCollection } from 'astro:content';

export const prerender = false;

export const GET = async () => {
  const posts = await getCollection('blog');
  const sample = posts.slice(0, 3).map((p: any) => ({
    keys: Object.keys(p),
    id: p.id,
    slug: p.slug,
    hasData: Boolean(p.data),
    tags: p.data?.tags ?? null,
    hold: p.data?.hold ?? null,
    pubDate: p.data?.pubDate,
  }));
  const champo = posts
    .filter((p: any) => p.data?.tags?.includes('championship'))
    .map((p: any) => ({ id: p.id, slug: p.slug, hold: p.data.hold, pubDate: p.data.pubDate }));
  return new Response(
    JSON.stringify({ total: posts.length, sample, champoCount: champo.length, champo }, null, 2),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
