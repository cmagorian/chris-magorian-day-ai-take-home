import { z } from 'zod';

/**
 * Request validation schemas. Zod gives us a single source of truth: it validates input
 * and infers the TypeScript types the handlers use.
 */

export const createFamilySchema = z.object({
  name: z.string().min(1, 'name is required'),
  members: z
    .array(z.object({ name: z.string().min(1, 'member name is required') }))
    .min(2, 'a family needs at least two members'),
  relationships: z
    .array(
      z.object({
        fromIndex: z.number().int().nonnegative(),
        toIndex: z.number().int().nonnegative(),
        type: z.enum(['spouse', 'parent', 'child']),
      }),
    )
    .optional(),
});

export const createExchangeSchema = z.object({
  year: z.number().int(),
  seed: z.number().int().optional(),
});

// Query string for reading a member's draws. `year` arrives as a string, so coerce it;
// omitting it means "all years". A non-numeric year fails here → 400.
export const memberDrawsQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
});

export type CreateFamilyBody = z.infer<typeof createFamilySchema>;
export type CreateExchangeBody = z.infer<typeof createExchangeSchema>;
