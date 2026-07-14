import { describe, expect, test } from '@jest/globals';
import { MemoryJournalStorage, OperationJournal } from '../../src/core/operation-journal.js';
import { OperationClock, OPERATION_DOMAINS } from '../../src/core/project-operations.js';

function operation(actorId = 'alpha') {
  return new OperationClock({ actorId }).create(
    OPERATION_DOMAINS.MIXER_MASTER,
    'set',
    { field: 'masterVolume' },
    { value: 0.5 }
  );
}

describe('OperationJournal', () => {
  test('persists pending operations and acknowledgements per room and actor', () => {
    const storage = new MemoryJournalStorage();
    const journal = new OperationJournal({ roomId: 'ROOM', actorId: 'alpha', storage, now: () => 100 });
    const op = operation();
    journal.enqueue(op, { peers: ['beta'] });
    journal.markSent(op.opId, { delivered: true, peerCount: 1, retryDelay: 800 });
    journal.acknowledge(op.opId, 'beta', { result: 'applied', at: 200 });

    const restored = new OperationJournal({ roomId: 'ROOM', actorId: 'alpha', storage });
    expect(restored.entries.get(op.opId)).toMatchObject({ status: 'acknowledged', attempts: 1 });
    expect(restored.diagnostics().counts.acknowledged).toBe(1);
  });

  test('returns due operations for bounded retry without discarding pending work', () => {
    let now = 100;
    const journal = new OperationJournal({ roomId: 'ROOM', actorId: 'alpha', storage: new MemoryJournalStorage(), now: () => now });
    const op = operation();
    journal.enqueue(op);
    journal.markSent(op.opId, { retryDelay: 800 });

    expect(journal.dueOperations()).toEqual([]);
    now = 901;
    expect(journal.dueOperations().map((entry) => entry.operation.opId)).toEqual([op.opId]);
    journal.setCheckpoint({ revision: 4 });
    expect(journal.entries.has(op.opId)).toBe(true);
  });

  test('tracks remote idempotency, conflicts, and recovery checkpoints', () => {
    const journal = new OperationJournal({ roomId: 'ROOM', actorId: 'alpha', storage: new MemoryJournalStorage(), now: () => 100 });
    const op = operation('beta');
    expect(journal.markApplied(op, { actorLabel: 'Beta' })).toBe(true);
    expect(journal.markApplied(op)).toBe(false);
    const conflict = journal.addConflict({ opId: op.opId, summary: 'cutoff conflict' });
    expect(journal.diagnostics().conflictCount).toBe(1);
    journal.resolveConflict(conflict.id, 'accept-remote');
    journal.setCheckpoint({ revision: 8, vector: { beta: 1 } });
    expect(journal.diagnostics()).toMatchObject({ conflictCount: 0, checkpoint: { revision: 8 } });
  });

  test('isolates persisted journals by room', () => {
    const storage = new MemoryJournalStorage();
    const roomA = new OperationJournal({ roomId: 'ROOM-A', actorId: 'alpha', storage });
    const op = operation();
    roomA.enqueue(op);
    const roomB = new OperationJournal({ roomId: 'ROOM-B', actorId: 'alpha', storage });

    expect(roomB.entries.size).toBe(0);
    roomB.setRoom('ROOM-A');
    expect(roomB.entries.has(op.opId)).toBe(true);
  });
});
