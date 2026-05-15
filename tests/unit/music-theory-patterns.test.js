// V11 Peer DAW/tests/unit/music-theory-patterns.test.js
// Music-theory pattern helpers for piano roll scales, chords, progressions, inversions, and syncopation.

import { describe, expect, test } from '@jest/globals';
import {
  applyHarmonicProgression,
  applyInversion,
  applySyncopation,
  buildChord,
  generateChordProgression,
  generateScale,
  harmonizeExistingPattern,
  noteNameToMidi,
  patternToPianoRollNotes,
  transposePatternToScaleDegree,
} from '../../src/core/music-theory-patterns.js';
import { PianoRollModule } from '../../src/modules/piano-roll.js';

describe('music theory primitives', () => {
  test('generates named scales from a root note across octaves', () => {
    expect(generateScale({ root: 'D3', scale: 'dorian', octaves: 1 })).toEqual([
      'D3',
      'E3',
      'F3',
      'G3',
      'A3',
      'B3',
      'C4',
      'D4',
    ]);
    expect(generateScale({ root: 'A2', scale: 'minorPentatonic', octaves: 1 })).toEqual([
      'A2',
      'C3',
      'D3',
      'E3',
      'G3',
      'A3',
    ]);
  });

  test('builds chords, extensions, and inversions', () => {
    expect(buildChord({ root: 'C4', quality: 'maj7' })).toEqual(['C4', 'E4', 'G4', 'B4']);
    expect(buildChord({ root: 'D3', quality: 'm9' })).toEqual(['D3', 'F3', 'A3', 'C4', 'E4']);
    expect(applyInversion(['C4', 'E4', 'G4', 'B4'], 2)).toEqual(['G4', 'B4', 'C5', 'E5']);
  });

  test('noteNameToMidi handles sharps and octave math', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('F#3')).toBe(54);
    expect(noteNameToMidi('Bb2')).toBe(46);
  });
});

describe('progressions and piano-roll application', () => {
  test('generates a roman numeral progression with extensions and voice-leading inversions', () => {
    const progression = generateChordProgression({
      root: 'C3',
      scale: 'major',
      progression: ['Imaj7', 'vi7', 'ii9', 'V13'],
      beatsPerChord: 2,
      voiceLead: true,
    });

    expect(progression.map((chord) => chord.symbol)).toEqual(['Imaj7', 'vi7', 'ii9', 'V13']);
    expect(progression[0]).toEqual(
      expect.objectContaining({ root: 'C3', quality: 'maj7', beat: 0, notes: ['C3', 'E3', 'G3', 'B3'] })
    );
    expect(progression[1].notes).toEqual(['E4', 'G4', 'A4', 'C5']);
    expect(progression[3].notes).toContain('E5');
  });

  test('converts progressions to piano-roll note events', () => {
    const progression = generateChordProgression({ root: 'A2', scale: 'minor', progression: ['i7', 'VImaj7'], beatsPerChord: 4 });
    const notes = patternToPianoRollNotes(progression, { velocity: 0.72, duration: 3.5 });

    expect(notes.slice(0, 4)).toEqual([
      { beat: 0, note: 'A2', velocity: 0.72, duration: 3.5 },
      { beat: 0, note: 'C3', velocity: 0.72, duration: 3.5 },
      { beat: 0, note: 'E3', velocity: 0.72, duration: 3.5 },
      { beat: 0, note: 'G3', velocity: 0.72, duration: 3.5 },
    ]);
    expect(notes.at(-1)).toEqual({ beat: 4, note: 'E4', velocity: 0.72, duration: 3.5 });
  });

  test('applies harmonic progression to an existing motif using scale degrees', () => {
    const motif = [
      { beat: 0, degree: 1, velocity: 0.8, duration: 0.5 },
      { beat: 0.5, degree: 3, velocity: 0.75, duration: 0.5 },
      { beat: 1, degree: 5, velocity: 0.7, duration: 0.5 },
    ];

    expect(transposePatternToScaleDegree(motif, { root: 'E3', scale: 'minor' })).toEqual([
      { beat: 0, note: 'E3', velocity: 0.8, duration: 0.5 },
      { beat: 0.5, note: 'G3', velocity: 0.75, duration: 0.5 },
      { beat: 1, note: 'B3', velocity: 0.7, duration: 0.5 },
    ]);

    const harmonized = applyHarmonicProgression(motif, {
      root: 'C3',
      scale: 'major',
      progression: ['I', 'V'],
      beatsPerChord: 2,
    });

    expect(harmonized.map((event) => event.note)).toEqual(['C3', 'E3', 'G3', 'G3', 'B3', 'D4']);
  });

  test('creates stacked harmony from an existing monophonic pattern', () => {
    const harmony = harmonizeExistingPattern(
      [
        { beat: 0, note: 'C4', velocity: 0.8, duration: 1 },
        { beat: 1, note: 'D4', velocity: 0.8, duration: 1 },
      ],
      { intervals: [0, 4, 7] }
    );

    expect(harmony).toEqual([
      { beat: 0, note: 'C4', velocity: 0.8, duration: 1 },
      { beat: 0, note: 'E4', velocity: 0.8, duration: 1 },
      { beat: 0, note: 'G4', velocity: 0.8, duration: 1 },
      { beat: 1, note: 'D4', velocity: 0.8, duration: 1 },
      { beat: 1, note: 'F#4', velocity: 0.8, duration: 1 },
      { beat: 1, note: 'A4', velocity: 0.8, duration: 1 },
    ]);
  });

  test('syncopates a straight pattern with offsets, accents, and ghost notes', () => {
    const pattern = [
      { beat: 0, note: 'C4', velocity: 0.8, duration: 0.5 },
      { beat: 1, note: 'D4', velocity: 0.8, duration: 0.5 },
      { beat: 2, note: 'E4', velocity: 0.8, duration: 0.5 },
      { beat: 3, note: 'G4', velocity: 0.8, duration: 0.5 },
    ];

    expect(applySyncopation(pattern, { offsetEvery: 2, offsetBeats: -0.25, accentEvery: 3, ghostEvery: 4 })).toEqual([
      { beat: 0, note: 'C4', velocity: 0.96, duration: 0.5 },
      { beat: 0.75, note: 'D4', velocity: 0.8, duration: 0.5 },
      { beat: 2, note: 'E4', velocity: 0.96, duration: 0.5 },
      { beat: 2.75, note: 'G4', velocity: 0.32, duration: 0.5 },
    ]);
  });
});

describe('PianoRollModule integration', () => {
  test('piano roll can receive a generated theory pattern as a control packet', () => {
    const roll = new PianoRollModule({ id: 'theory-roll', notes: [] });

    roll.receive({
      kind: 'control',
      type: 'apply-theory-pattern',
      pattern: {
        kind: 'progression',
        root: 'C3',
        scale: 'major',
        progression: ['Imaj7', 'IVmaj7'],
        beatsPerChord: 2,
        velocity: 0.66,
        duration: 1.75,
      },
    });

    expect(roll.notes.map(({ beat, note, velocity, duration }) => ({ beat, note, velocity, duration }))).toEqual([
      { beat: 0, note: 'C3', velocity: 0.66, duration: 1.75 },
      { beat: 0, note: 'E3', velocity: 0.66, duration: 1.75 },
      { beat: 0, note: 'G3', velocity: 0.66, duration: 1.75 },
      { beat: 0, note: 'B3', velocity: 0.66, duration: 1.75 },
      { beat: 2, note: 'F3', velocity: 0.66, duration: 1.75 },
      { beat: 2, note: 'A3', velocity: 0.66, duration: 1.75 },
      { beat: 2, note: 'C4', velocity: 0.66, duration: 1.75 },
      { beat: 2, note: 'E4', velocity: 0.66, duration: 1.75 },
    ]);
    expect(roll.lengthBeats).toBe(4);
  });
});
