import type { ConstraintRule } from './ConstraintRule';

/**
 * Part Three: nobody is the Secret Santa for a member of their immediate family
 * (spouse, parents, or children) — those gifts are covered within the household.
 */
export const immediateFamilyRule: ConstraintRule = {
  name: 'no-immediate-family',
  isAllowed(giverId, receiverId, ctx) {
    const relatives = ctx.immediateFamily.get(giverId);
    return !relatives || !relatives.has(receiverId);
  },
};
