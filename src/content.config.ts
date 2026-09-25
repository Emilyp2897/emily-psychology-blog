import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    /**
     * Editorial hold. Locks a post regardless of its pubDate, so an article
     * can be pulled back without inventing a fake release date for it. The
     * hub cards show "Coming soon" instead of a date, and the article page
     * itself is gated. Delete the line to publish.
     */
    hold: z.boolean().default(false),
    // Temporarily remove heroImage to fix build
    track: z.enum([
      'training-the-mind',
      'gael-performance-toolkit',
      'stronger-minds-stronger-players',
      'mindfulness-and-affirmations',
    ]),
    tags: z.array(z.string()).optional(),
    /** Optional hero photo, a path under /public (e.g. /assets/articles/x.jpg). */
    photo: z.string().optional(),
    photoAlt: z.string().optional(),
    /**
     * Which part of the hero photo to keep when it gets cropped to the wide
     * banner shape. Any CSS object-position value, e.g. "center 85%".
     *
     * Defaults to "center 30%", which suits a portrait or action shot where
     * the subject is high in the frame. A team photo taken from a distance
     * puts everyone low in the frame, so it needs a much higher percentage
     * or the banner shows nothing but sky.
     *
     * Higher percentage means you see further DOWN the photo.
     */
    photoPosition: z.string().optional(),
  }),
});

export const collections = { blog };