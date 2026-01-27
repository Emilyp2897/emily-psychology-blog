import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // Temporarily remove heroImage to fix build
    track: z.enum(['applied-psychology', 'sports-psychology', 'mental-health']),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };