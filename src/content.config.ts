import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    // Add your three psychology tracks
    track: z.enum(['applied-psychology', 'sports-psychology', 'mental-health']),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };