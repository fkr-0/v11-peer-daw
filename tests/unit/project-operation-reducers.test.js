import { describe, expect, test } from '@jest/globals';
import { OperationClock, OPERATION_DOMAINS } from '../../src/core/project-operations.js';
import { applyProjectOperation } from '../../src/core/project-operation-reducers.js';

function project() {
  return {
    version: 1,
    modules: [
      { id: 'synth', kind: 'synth', cutoff: 1000, notes: [] },
      { id: 'clock', kind: 'clock', bpm: 120 },
    ],
    mixer: { masterVolume: 0.8, channels: { synth: { gain: 0.8, pan: 0, muted: false, solo: false } } },
    clips: { currentBeat: 0, slots: [{ id: 'slot-1', launchBeat: null, stopBeat: null }] },
    arrangement: { loopStartBeat: 0, loopEndBeat: 16, clips: [] },
  };
}

describe('project operation reducers', () => {
  test('preserves concurrent changes to different fields', () => {
    const alpha = new OperationClock({ actorId: 'alpha' });
    const beta = new OperationClock({ actorId: 'beta' });
    const cutoff = alpha.create(OPERATION_DOMAINS.MODULE_PARAMETER, 'set', { moduleId: 'synth', parameter: 'cutoff' }, { value: 2200 });
    const gain = beta.create(OPERATION_DOMAINS.MIXER_CHANNEL, 'set', { channelId: 'synth', field: 'gain' }, { value: 0.45 });
    const context = { fieldVersions: new Map(), tombstones: new Map() };

    const first = applyProjectOperation(project(), cutoff, context);
    const second = applyProjectOperation(first.project, gain, context);

    expect(second.status).toBe('applied');
    expect(second.project.modules[0].cutoff).toBe(2200);
    expect(second.project.mixer.channels.synth.gain).toBe(0.45);
  });

  test('resolves the same scalar field identically regardless of arrival order', () => {
    const alpha = new OperationClock({ actorId: 'alpha' }).create(
      OPERATION_DOMAINS.MODULE_PARAMETER,
      'set',
      { moduleId: 'synth', parameter: 'cutoff' },
      { value: 1800 }
    );
    const beta = new OperationClock({ actorId: 'beta' }).create(
      OPERATION_DOMAINS.MODULE_PARAMETER,
      'set',
      { moduleId: 'synth', parameter: 'cutoff' },
      { value: 3200 }
    );

    const run = (operations) => {
      const context = { fieldVersions: new Map(), tombstones: new Map() };
      return operations.reduce((state, operation) => applyProjectOperation(state, operation, context).project, project());
    };

    expect(run([alpha, beta]).modules[0].cutoff).toBe(3200);
    expect(run([beta, alpha]).modules[0].cutoff).toBe(3200);
  });

  test('adds, updates, deletes, and deduplicates stable musical entities', () => {
    const clock = new OperationClock({ actorId: 'alpha' });
    const context = { fieldVersions: new Map(), tombstones: new Map() };
    const note = { id: 'note-1', beat: 0, note: 'C4', velocity: 0.8, duration: 1 };
    const add = clock.create(OPERATION_DOMAINS.NOTE, 'add', { moduleId: 'synth', noteId: note.id }, { note });
    const update = clock.create(OPERATION_DOMAINS.NOTE, 'update', { moduleId: 'synth', noteId: note.id, field: 'velocity' }, { patch: { velocity: 0.5 } });
    const remove = clock.create(OPERATION_DOMAINS.NOTE, 'delete', { moduleId: 'synth', noteId: note.id }, {});

    const added = applyProjectOperation(project(), add, context);
    expect(added.project.modules[0].notes).toEqual([note]);
    expect(applyProjectOperation(added.project, add, context).status).toBe('duplicate');
    const updated = applyProjectOperation(added.project, update, context);
    expect(updated.project.modules[0].notes[0].velocity).toBe(0.5);
    const deleted = applyProjectOperation(updated.project, remove, context);
    expect(deleted.project.modules[0].notes).toEqual([]);
  });

  test('applies batches atomically and rejects a partial invalid batch', () => {
    const clock = new OperationClock({ actorId: 'alpha' });
    const validNested = clock.create(OPERATION_DOMAINS.MIXER_MASTER, 'set', { field: 'masterVolume' }, { value: 0.3 });
    const invalidNested = clock.create(OPERATION_DOMAINS.NOTE, 'update', { moduleId: 'missing', noteId: 'n', field: 'velocity' }, { patch: { velocity: 0.1 } });
    const batch = clock.create(OPERATION_DOMAINS.BATCH, 'apply', { batchId: 'b1' }, { operations: [validNested, invalidNested] });
    const result = applyProjectOperation(project(), batch, { fieldVersions: new Map(), tombstones: new Map() });

    expect(result.status).toBe('rejected');
    expect(result.project.mixer.masterVolume).toBe(0.8);
  });

  test('uses stable placement ids for arrangement operations', () => {
    const clock = new OperationClock({ actorId: 'alpha' });
    const context = { fieldVersions: new Map(), tombstones: new Map() };
    const placement = { placementId: 'place-1', startBeat: 4, trackId: 'synth', clip: { id: 'clip-1', name: 'Verse' } };
    const add = clock.create(OPERATION_DOMAINS.ARRANGEMENT_PLACEMENT, 'add', { placementId: placement.placementId }, { placement });
    const move = clock.create(OPERATION_DOMAINS.ARRANGEMENT_PLACEMENT, 'update', { placementId: placement.placementId, field: 'startBeat' }, { patch: { startBeat: 12 } });

    const added = applyProjectOperation(project(), add, context);
    const moved = applyProjectOperation(added.project, move, context);
    expect(moved.project.arrangement.clips[0]).toMatchObject({ placementId: 'place-1', startBeat: 12 });
  });
});
