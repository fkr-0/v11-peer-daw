import { describe, expect, test } from '@jest/globals';
import { PeernetStack } from '../../src/core/peernet-stack.js';

describe('PeernetStack session isolation', () => {
  test('derives stable, session-specific hub ids', () => {
    const stack = new PeernetStack({ namespace: 'v11-peer-daw' });
    expect(stack.hubIdForProfile({ sessionCode: 'ROOM 42 / Blue' })).toBe(
      'v11-peer-daw-room-42-blue-hub'
    );
    expect(stack.hubIdForProfile({ sessionCode: 'ROOM 43' })).not.toBe(
      stack.hubIdForProfile({ sessionCode: 'ROOM 42' })
    );
  });

  test('refreshes an existing shared session instead of returning stale metadata', () => {
    const existing = { id: 'session-a', code: 'OLD', title: 'Old', mode: 'closed' };
    const calls = [];
    const stack = new PeernetStack();
    stack.sessions = {
      sessions: [existing],
      joinSession(session) {
        this.active = session;
      },
      getActiveSession() {
        return this.active;
      },
      save() {
        calls.push('save');
      },
      announceUpdate(session) {
        calls.push(`announce:${session.code}`);
      },
    };

    const session = stack.ensureSharedSession({
      id: 'session-a',
      code: 'ROOM42',
      title: 'Shared room',
    });

    expect(session).toBe(existing);
    expect(existing).toEqual(
      expect.objectContaining({ code: 'ROOM42', title: 'Shared room', mode: 'open-collab' })
    );
    expect(calls).toEqual(['save', 'announce:ROOM42']);
  });
});

