import { describe, expect, test } from '@jest/globals';
import { CollaborationEngine } from '../../src/core/collaboration-engine.js';
import { MemoryJournalStorage } from '../../src/core/operation-journal.js';
import { OPERATION_DOMAINS } from '../../src/core/project-operations.js';

function linkedEngines() {
  const queueA = [];
  const queueB = [];
  const appliedA = [];
  const appliedB = [];
  const common = { storage: new MemoryJournalStorage(), setIntervalFn: null, clearIntervalFn: null };
  const a = new CollaborationEngine({
    ...common,
    actorId: 'alpha',
    sessionCode: 'ROOM',
    send: (message) => {
      queueB.push(message);
      return [{ delivered: true, peerCount: 1 }];
    },
    applyOperation: (operation) => {
      appliedA.push(operation);
      return { status: 'applied' };
    },
  });
  const b = new CollaborationEngine({
    ...common,
    actorId: 'beta',
    sessionCode: 'ROOM',
    send: (message) => {
      queueA.push(message);
      return [{ delivered: true, peerCount: 1 }];
    },
    applyOperation: (operation) => {
      appliedB.push(operation);
      return { status: 'applied' };
    },
  });
  const flush = () => {
    while (queueA.length || queueB.length) {
      while (queueA.length) a.receive(queueA.shift(), { transport: 'peernet', peerId: 'beta-peer' });
      while (queueB.length) b.receive(queueB.shift(), { transport: 'peernet', peerId: 'alpha-peer' });
    }
  };
  return { a, b, appliedA, appliedB, flush, queueA, queueB };
}

describe('CollaborationEngine', () => {
  test('negotiates capabilities, delivers operations, and acknowledges them', () => {
    const { a, b, appliedB, flush } = linkedEngines();
    a.start();
    b.start();
    flush();
    expect(a.compatiblePeerIds()).toEqual(['beta']);
    expect(b.compatiblePeerIds()).toEqual(['alpha']);

    const op = a.publish(
      OPERATION_DOMAINS.MODULE_PARAMETER,
      'set',
      { moduleId: 'synth', parameter: 'cutoff' },
      { value: 2400 }
    );
    flush();

    expect(appliedB).toEqual([op]);
    expect(a.journal.entries.get(op.opId).status).toBe('acknowledged');
    expect(a.diagnostics()).toMatchObject({ pendingCount: 0, state: 'synced' });
  });

  test('deduplicates repeated operation delivery and acknowledges duplicates', () => {
    const { a, b, appliedB, flush, queueB } = linkedEngines();
    a.start();
    b.start();
    flush();
    a.publish(OPERATION_DOMAINS.MIXER_MASTER, 'set', { field: 'masterVolume' }, { value: 0.4 });
    const message = queueB[0];
    queueB.push(message);
    flush();

    expect(appliedB).toHaveLength(1);
    expect(b.journal.diagnostics().appliedCount).toBe(1);
  });

  test('persists and replays pending operations after reconnect', () => {
    const storage = new MemoryJournalStorage();
    const sent = [];
    const first = new CollaborationEngine({
      actorId: 'alpha',
      sessionCode: 'ROOM',
      storage,
      send: (message) => {
        sent.push(message);
        return [{ delivered: false, peerCount: 0 }];
      },
      setIntervalFn: null,
      clearIntervalFn: null,
    });
    const operation = first.publish(OPERATION_DOMAINS.CLOCK, 'set-bpm', { moduleId: 'clock' }, { value: 128 });
    const restoredSent = [];
    const restored = new CollaborationEngine({
      actorId: 'alpha',
      sessionCode: 'ROOM',
      storage,
      send: (message) => {
        restoredSent.push(message);
        return [{ delivered: true, peerCount: 1 }];
      },
      setIntervalFn: null,
      clearIntervalFn: null,
    });

    expect(restored.journal.entries.has(operation.opId)).toBe(true);
    expect(restored.replayPending()).toBe(1);
    expect(restoredSent[0].operation.opId).toBe(operation.opId);
  });
});
