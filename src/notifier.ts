import { logger } from './logger';
import type { Assignment } from './domain/types';

/**
 * Side-channel for telling a participant who they drew. A real implementation would send
 * email/SMS/push (or hand off to a durable queue); for the exercise we log. Kept behind an
 * interface so the notification hook depends on the abstraction and tests can inject a
 * recording fake.
 */
export interface Notifier {
  /** Tell one giver who they drew. */
  send(familyId: string, year: number, assignment: Assignment): Promise<void> | void;
}

/** Default `Notifier` that logs each match via the structured logger (no real delivery). */
export const loggingNotifier: Notifier = {
  send(familyId, year, assignment) {
    logger.info(
      { familyId, year, giverId: assignment.giverId, receiverId: assignment.receiverId },
      'Notifying Secret Santa of their match',
    );
  },
};

/** The payload handed to the notification hook after a draw completes. */
export interface ExchangeNotification {
  familyId: string;
  year: number;
  assignments: Assignment[];
}

// Announce every pairing of a draw. The seam a real email/SMS/push (or a durable-queue
// enqueue) would replace; loggingNotifier keeps it observable in the meantime.
export async function notifyParticipants(
  notifier: Notifier,
  data: ExchangeNotification,
): Promise<void> {
  for (const assignment of data.assignments) {
    await notifier.send(data.familyId, data.year, assignment);
  }
}
