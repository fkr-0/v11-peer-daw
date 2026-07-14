import { describe, expect, test } from '@jest/globals';
import { PROJECT_SYNC_PROTOCOL, ProjectSyncState } from '../../src/core/project-sync.js';

describe('ProjectSyncState', () => {
  test('creates versioned room-scoped messages and deduplicates cross-transport delivery', () => {
    const sender = new ProjectSyncState({ clientId: 'alpha', sessionCode: 'ROOM-1' });
    const receiver = new ProjectSyncState({ clientId: 'beta', sessionCode: 'ROOM-1' });
    const message = sender.create('update', { version: 3 });

    expect(message).toEqual(
      expect.objectContaining({
        protocol: PROJECT_SYNC_PROTOCOL,
        type: 'project-update',
        clientId: 'alpha',
        sessionCode: 'ROOM-1',
        version: 3,
      })
    );
    expect(receiver.accept(message, { transport: 'local', receivedAt: 100 })).toBe(true);
    expect(receiver.accept(message, { transport: 'peernet', receivedAt: 101 })).toBe(false);
    expect(receiver.diagnostics().transports.local.receivedAt).toBe(100);
  });

  test('rejects self, foreign-room, and unsupported protocol messages', () => {
    const state = new ProjectSyncState({ clientId: 'alpha', sessionCode: 'ROOM-1' });
    const base = {
      protocol: PROJECT_SYNC_PROTOCOL,
      type: 'project-request',
      messageId: 'm1',
      clientId: 'beta',
      sessionCode: 'ROOM-1',
    };

    expect(state.accept({ ...base, clientId: 'alpha' })).toBe(false);
    expect(state.accept({ ...base, sessionCode: 'ROOM-2' })).toBe(false);
    expect(state.accept({ ...base, protocol: 99 })).toBe(false);
  });

  test('resets room history and exposes transport delivery diagnostics', () => {
    const state = new ProjectSyncState({ clientId: 'alpha', sessionCode: 'ROOM-1' });
    state.markSent('peernet', { sentAt: 200, delivered: true, peerCount: 2 });
    state.markAck({ at: 240, clientId: 'beta' });

    expect(state.diagnostics()).toEqual(
      expect.objectContaining({
        lastAckAt: 240,
        lastAckClientId: 'beta',
        transports: {
          peernet: { sentAt: 200, receivedAt: 0, delivered: true, peerCount: 2 },
        },
      })
    );

    state.setSessionCode('ROOM-2');
    expect(state.diagnostics()).toEqual(
      expect.objectContaining({ transports: {}, lastAckAt: 0, seenCount: 0 })
    );
  });
});
