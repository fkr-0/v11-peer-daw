import { describe, expect, test } from '@jest/globals';
import { compactSyncLabel } from '../../src/ui/sync-center.js';

describe('Sync Center status labels', () => {
  test('prioritizes conflict, pending, recovery, and synced states', () => {
    expect(compactSyncLabel({ conflictCount: 2, pendingCount: 4 })).toBe('2 CONFLICTS');
    expect(compactSyncLabel({ conflictCount: 0, pendingCount: 3 })).toBe('3 PENDING');
    expect(compactSyncLabel({ conflictCount: 0, pendingCount: 0, state: 'retrying' })).toBe(
      'RECONNECTING'
    );
    expect(compactSyncLabel({ conflictCount: 0, pendingCount: 0, state: 'recovered' })).toBe(
      'RECOVERED'
    );
    expect(compactSyncLabel({ conflictCount: 0, pendingCount: 0, state: 'synced' })).toBe(
      'SYNCED'
    );
  });
});
