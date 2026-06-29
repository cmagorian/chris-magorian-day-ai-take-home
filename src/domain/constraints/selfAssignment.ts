import type { ConstraintRule } from './ConstraintRule';

/**
 * Part One: a person cannot be their own Secret Santa.
 */
export const selfAssignmentRule: ConstraintRule = {
  name: 'no-self-assignment',
  isAllowed(giverId, receiverId) {
    return giverId !== receiverId;
  },
};
