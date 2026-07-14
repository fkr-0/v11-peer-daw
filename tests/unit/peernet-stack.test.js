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

  test('keeps message subscriptions registered before the transport is initialized', () => {
    const listeners = new Map();
    const stack = new PeernetStack();
    const received = [];
    stack.onMessage('project-sync', (data, meta) => received.push({ data, meta }));
    stack.core = {
      on(type, handler) {
        listeners.set(type, handler);
      },
    };

    stack.bindPendingMessageTypes();
    listeners.get('message:artifact:project-sync')({
      id: 'peer-a',
      entry: { username: 'Alpha' },
      data: { type: 'artifact:project-sync', data: { kind: 'snapshot', version: 4 } },
    });

    expect(received).toHaveLength(1);
    expect(received[0].data).toEqual({ kind: 'snapshot', version: 4 });
    expect(received[0].meta).toEqual(
      expect.objectContaining({ peerId: 'peer-a', entry: { username: 'Alpha' } })
    );
  });

  test('reports broadcast delivery and supports targeted project messages', () => {
    const sent = [];
    const stack = new PeernetStack();
    stack.core = {
      connections: new Map([
        ['peer-a', { conn: { open: true } }],
        ['peer-b', { conn: { open: true } }],
      ]),
      broadcast(message) {
        sent.push(['broadcast', message]);
      },
      send(peerId, message) {
        sent.push(['send', peerId, message]);
      },
    };

    const broadcast = stack.broadcast('project-sync', { kind: 'update' });
    const targeted = stack.send('project-sync', { kind: 'ack' }, 'peer-a');

    expect(broadcast).toEqual(expect.objectContaining({ peerCount: 2, delivered: true }));
    expect(targeted).toEqual(
      expect.objectContaining({ peerId: 'peer-a', peerCount: 1, delivered: true })
    );
    expect(sent).toEqual([
      [
        'broadcast',
        expect.objectContaining({
          type: 'artifact:project-sync',
          data: { kind: 'update' },
        }),
      ],
      [
        'send',
        'peer-a',
        expect.objectContaining({ type: 'artifact:project-sync', data: { kind: 'ack' } }),
      ],
    ]);
  });
});

