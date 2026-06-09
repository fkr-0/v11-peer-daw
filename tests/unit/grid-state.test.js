import { describe, expect, test } from '@jest/globals';
import {
  gridCellKey,
  gridDataFromKey,
  midiToNoteName,
  noteNameToMidi,
  selectedGridData,
} from '../../src/core/grid-state.js';

describe('grid-state helpers', () => {
  test('creates stable grid cell keys from mixed grid metadata', () => {
    expect(gridCellKey({ gridKind: 'piano', moduleId: 'roll-a', note: 'C4', step: 3 })).toBe(
      'piano:roll-a:C4:3'
    );
    expect(
      gridCellKey({ gridKind: 'sequencer', moduleId: 'seq-a', rowId: 'kick', stepIndex: 0 })
    ).toBe('sequencer:seq-a:kick:0');
    expect(gridCellKey({ gridKind: 'ocra', moduleId: 'grid-a', rowIndex: 4, colIndex: 8 })).toBe(
      'ocra:grid-a:4:8'
    );
  });

  test('round-trips grid cell keys into broad cell metadata aliases', () => {
    expect(gridDataFromKey('piano:roll-a:C#4:12')).toEqual({
      gridKind: 'piano',
      moduleId: 'roll-a',
      rowId: 'C#4',
      note: 'C#4',
      rowIndex: 'C#4',
      stepIndex: '12',
      step: '12',
      colIndex: '12',
    });
    expect(selectedGridData(new Set(['piano:roll-a:C4:1', 'ocra:grid-a:2:3']))).toEqual([
      gridDataFromKey('piano:roll-a:C4:1'),
      gridDataFromKey('ocra:grid-a:2:3'),
    ]);
  });

  test('converts note names and MIDI numbers with safe fallbacks', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('A#3')).toBe(58);
    expect(noteNameToMidi('invalid')).toBe(60);
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(-10)).toBe('C-1');
    expect(midiToNoteName(999)).toBe('G9');
  });
});
