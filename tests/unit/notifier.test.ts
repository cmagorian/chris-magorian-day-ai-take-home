import { describe, expect, it, vi } from 'vitest';
import { notifyParticipants, type Notifier } from '../../src/notifier';

describe('notifyParticipants (notification hook)', () => {
  it('notifies every participant exactly once', async () => {
    const send = vi.fn();
    const notifier: Notifier = { send };

    await notifyParticipants(notifier, {
      familyId: 'fam-1',
      year: 2026,
      assignments: [
        { giverId: 'a', receiverId: 'b' },
        { giverId: 'b', receiverId: 'c' },
        { giverId: 'c', receiverId: 'a' },
      ],
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith('fam-1', 2026, { giverId: 'a', receiverId: 'b' });
  });

  it('does nothing for an empty assignment list', async () => {
    const send = vi.fn();
    await notifyParticipants({ send }, { familyId: 'fam-1', year: 2026, assignments: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
