import { describe, expect, test } from '@jest/globals';
import {
  COLLABORATION_PROTOCOL,
  OPERATION_DOMAINS,
  OperationClock,
  compareOperationClock,
  createOperationMessage,
  operationFieldKey,
  summarizeOperation,
  validateOperation,
} from '../../src/core/project-operations.js';

describe('project operations', () => {
  test('creates stable actor-local operations with Lamport clocks', () => {
    const clock = new OperationClock({ actorId: 'alpha' });
    const first = clock.create(
      OPERATION_DOMAINS.MODULE_PARAMETER,
      'set',
      { moduleId: 'synth', parameter: 'cutoff' },
      { value: 2400 },
      { baseRevision: 3 }
    );
    clock.observe({ lamport: 8 });
    const second = clock.create(
      OPERATION_DOMAINS.MIXER_MASTER,
      'set',
      { field: 'masterVolume' },
      { value: 0.7 }
    );

    expect(first).toMatchObject({ opId: 'alpha:1', sequence: 1, lamport: 1, baseRevision: 3 });
    expect(second).toMatchObject({ opId: 'alpha:2', sequence: 2, lamport: 9 });
    expect(validateOperation(first)).toEqual({ valid: true, errors: [] });
    expect(operationFieldKey(first)).toBe('module-parameter:synth:cutoff');
    const note = clock.create(
      OPERATION_DOMAINS.NOTE,
      'update',
      { moduleId: 'roll', noteId: 'note-3', field: 'velocity' },
      { patch: { velocity: 0.4 } }
    );
    expect(operationFieldKey(note)).toBe('note:note-3:velocity');
  });

  test('validates domains/actions and rejects oversized payloads', () => {
    const clock = new OperationClock({ actorId: 'alpha' });
    const unsupported = clock.create('unknown', 'set', {}, { value: 1 });
    const oversized = clock.create(
      OPERATION_DOMAINS.MODULE_PARAMETER,
      'set',
      { moduleId: 'synth', parameter: 'blob' },
      { value: 'x'.repeat(70 * 1024) }
    );

    expect(validateOperation(unsupported).errors).toContain('domain');
    expect(validateOperation(oversized).errors).toContain('payload-too-large');
  });

  test('orders concurrent scalar clocks deterministically by actor id', () => {
    expect(compareOperationClock({ lamport: 5, actorId: 'alpha' }, { lamport: 4, actorId: 'zeta' })).toBeGreaterThan(0);
    expect(compareOperationClock({ lamport: 5, actorId: 'alpha' }, { lamport: 5, actorId: 'zeta' })).toBeLessThan(0);
  });

  test('creates protocol 2 envelopes and human-readable activity summaries', () => {
    const operation = new OperationClock({ actorId: 'alpha' }).create(
      OPERATION_DOMAINS.MODULE_PARAMETER,
      'set',
      { moduleId: 'main-synth', moduleTitle: 'Main Synth', parameter: 'cutoff' },
      { value: 2400 }
    );
    const message = createOperationMessage({ clientId: 'alpha', sessionCode: 'ROOM', operation, at: 100 });

    expect(message).toMatchObject({ protocol: COLLABORATION_PROTOCOL, type: 'project-operation', sessionCode: 'ROOM' });
    expect(summarizeOperation(operation, { actorLabel: 'Mara' })).toBe('Mara changed Main Synth cutoff to 2400');
  });
});
