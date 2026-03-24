import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // Temporarily remove heroImage to fix build
    track: z.enum(['Training-the-Mind', 'Gael-Performance-Toolkit', 'Stronger-Minds-Stronger-Players']),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };