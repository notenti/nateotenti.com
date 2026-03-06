import { defineCollection, z } from 'astro:content';

const life = defineCollection({
  type: 'content',
  schema: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('album'),
      title: z.string(),
      date: z.coerce.date(),
      location: z.string(),
      cover: z.string(),
      intro: z.string().optional(),
    }),
    z.object({
      type: z.literal('text'),
      title: z.string(),
      date: z.coerce.date(),
      location: z.string(),
      intro: z.string().optional(),
    }),
  ]),
});

export const collections = { life };
