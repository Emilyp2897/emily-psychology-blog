import { getCollection } from 'astro:content';
import { isReleased } from '../data/release';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	// Released posts only. This used to list every non-draft post, so the
	// titles and dates of locked and held articles were readable in the feed.
	const posts = await getCollection('blog', (post) => !post.data.draft && isReleased(post));
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${post.id}/`,
		})),
	});
}
