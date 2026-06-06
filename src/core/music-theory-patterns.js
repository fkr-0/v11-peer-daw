// V11 Peer DAW/src/core/music-theory-patterns.js
// Music-theory pattern helpers for piano roll generation.

const NOTE_TO_PC = Object.freeze({
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
});

const PC_TO_SHARP = Object.freeze([
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]);

export const SCALE_INTERVALS = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
});

const QUALITY_INTERVALS = Object.freeze({
  '': [0, 4, 7],
  major: [0, 4, 7],
  maj: [0, 4, 7],
  minor: [0, 3, 7],
  min: [0, 3, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  11: [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  13: [0, 4, 7, 10, 14, 21],
  m13: [0, 3, 7, 10, 14, 21],
});

const ROMAN = Object.freeze({ I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 });

function mod(value, base) {
  return ((value % base) + base) % base;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function noteNameToMidi(note = 'C4') {
  const match = String(note).match(/^([A-G](?:#|b)?)(-?\d+)$/);
  if (!match) throw new Error(`Invalid note name: ${note}`);
  const pc = NOTE_TO_PC[match[1]];
  if (pc === undefined) throw new Error(`Invalid pitch class: ${match[1]}`);
  return (Number(match[2]) + 1) * 12 + pc;
}

export function midiToNoteName(midi = 60) {
  const value = Math.round(Number(midi));
  const pc = mod(value, 12);
  const octave = Math.floor(value / 12) - 1;
  return `${PC_TO_SHARP[pc]}${octave}`;
}

export function transposeNote(note, semitones = 0) {
  return midiToNoteName(noteNameToMidi(note) + Number(semitones));
}

export function generateScale({ root = 'C4', scale = 'major', octaves = 1 } = {}) {
  const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
  const rootMidi = noteNameToMidi(root);
  const notes = [];
  for (let octave = 0; octave < Number(octaves); octave += 1) {
    for (const interval of intervals) notes.push(midiToNoteName(rootMidi + octave * 12 + interval));
  }
  notes.push(midiToNoteName(rootMidi + Number(octaves) * 12));
  return notes;
}

export function buildChord({ root = 'C4', quality = 'major' } = {}) {
  const intervals = QUALITY_INTERVALS[quality] || QUALITY_INTERVALS.major;
  const rootMidi = noteNameToMidi(root);
  return intervals.map((interval) => midiToNoteName(rootMidi + interval));
}

export function applyInversion(notes = [], inversion = 0) {
  const result = notes.slice();
  for (let index = 0; index < Number(inversion); index += 1) {
    const shifted = result.shift();
    if (shifted) result.push(transposeNote(shifted, 12));
  }
  return result;
}

function parseRomanSymbol(symbol = 'I') {
  const match = String(symbol).match(/^([b#]?)([ivIV]+)(.*)$/);
  if (!match) throw new Error(`Invalid roman progression symbol: ${symbol}`);
  const [, accidental, numeralRaw, suffixRaw] = match;
  const numeral = numeralRaw.toUpperCase();
  const degree = ROMAN[numeral];
  if (degree === undefined) throw new Error(`Unsupported roman numeral: ${symbol}`);
  const accidentalOffset = accidental === 'b' ? -1 : accidental === '#' ? 1 : 0;
  const suffix = suffixRaw || '';
  const isLowercase = numeralRaw === numeralRaw.toLowerCase();
  let quality = '';
  if (suffix) quality = isLowercase && /^[679]|^11|^13/.test(suffix) ? `m${suffix}` : suffix;
  else quality = isLowercase ? 'm' : 'major';
  if (quality === 'maj') quality = 'major';
  if (quality === 'm') quality = 'm';
  return { degree, quality, accidentalOffset, symbol };
}

function scaleDegreeRoot({ root = 'C3', scale = 'major', degree = 0, accidentalOffset = 0 }) {
  const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
  const octave = Math.floor(degree / intervals.length);
  const index = mod(degree, intervals.length);
  return midiToNoteName(noteNameToMidi(root) + intervals[index] + octave * 12 + accidentalOffset);
}

function chooseVoiceLeadingInversion(previousNotes, nextNotes) {
  if (!previousNotes?.length) return nextNotes;
  const previousTop = Math.max(...previousNotes.map(noteNameToMidi));
  for (let inversion = 0; inversion < nextNotes.length; inversion += 1) {
    const candidate = applyInversion(nextNotes, inversion);
    if (noteNameToMidi(candidate[0]) >= previousTop + 4) return candidate;
  }
  return nextNotes;
}

export function generateChordProgression({
  root = 'C3',
  scale = 'major',
  progression = ['I', 'IV', 'V', 'I'],
  beatsPerChord = 4,
  voiceLead = false,
} = {}) {
  let previousNotes = null;
  return progression.map((symbol, index) => {
    const parsed = parseRomanSymbol(symbol);
    const chordRoot = scaleDegreeRoot({
      root,
      scale,
      degree: parsed.degree,
      accidentalOffset: parsed.accidentalOffset,
    });
    let notes = buildChord({ root: chordRoot, quality: parsed.quality });
    if (voiceLead) notes = chooseVoiceLeadingInversion(previousNotes, notes);
    previousNotes = notes;
    return {
      symbol,
      root: chordRoot,
      quality: parsed.quality,
      beat: index * beatsPerChord,
      duration: beatsPerChord,
      notes,
    };
  });
}

export function patternToPianoRollNotes(progression = [], { velocity = 0.8, duration } = {}) {
  return progression.flatMap((chord) =>
    chord.notes.map((note) => ({
      beat: chord.beat,
      note,
      velocity,
      duration: duration ?? chord.duration,
    }))
  );
}

export function transposePatternToScaleDegree(pattern = [], { root = 'C3', scale = 'major' } = {}) {
  const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.major;
  const rootMidi = noteNameToMidi(root);
  return pattern.map((event) => {
    const zeroDegree = Number(event.degree ?? 1) - 1;
    const octave = Math.floor(zeroDegree / intervals.length);
    const degreeIndex = mod(zeroDegree, intervals.length);
    return {
      beat: event.beat,
      note: midiToNoteName(rootMidi + octave * 12 + intervals[degreeIndex]),
      velocity: event.velocity ?? 0.8,
      duration: event.duration ?? 0.5,
    };
  });
}

export function applyHarmonicProgression(motif = [], options = {}) {
  const progression = generateChordProgression(options);
  const beatsPerChord = Number(options.beatsPerChord ?? 4);
  return progression.flatMap((chord) => {
    const local = transposePatternToScaleDegree(motif, {
      root: chord.root,
      scale: options.scale || 'major',
    });
    return local
      .map((event) => ({ ...event, beat: event.beat + chord.beat }))
      .filter((event) => event.beat < chord.beat + beatsPerChord);
  });
}

export function harmonizeExistingPattern(pattern = [], { intervals = [0, 4, 7] } = {}) {
  return pattern.flatMap((event) =>
    intervals.map((interval) => ({
      beat: event.beat,
      note: transposeNote(event.note, interval),
      velocity: event.velocity ?? 0.8,
      duration: event.duration ?? 0.5,
    }))
  );
}

export function applySyncopation(
  pattern = [],
  {
    offsetEvery = 2,
    offsetBeats = -0.25,
    accentEvery = 3,
    ghostEvery = 0,
    accentGain = 1.2,
    ghostGain = 0.4,
  } = {}
) {
  return pattern.map((event, index) => {
    const position = index + 1;
    const shouldOffset = offsetEvery > 0 && position % offsetEvery === 0;
    const shouldAccent =
      accentEvery > 0 && (index % accentEvery === 0 || position % accentEvery === 0);
    const shouldGhost = ghostEvery > 0 && position % ghostEvery === 0;
    const gain = shouldGhost ? ghostGain : shouldAccent ? accentGain : 1;
    return {
      ...event,
      beat: round((event.beat ?? 0) + (shouldOffset ? offsetBeats : 0)),
      velocity: round(clamp((event.velocity ?? 0.8) * gain, 0, 1)),
    };
  });
}

export function createTheoryPattern(pattern = {}) {
  if (pattern.kind === 'progression') {
    return patternToPianoRollNotes(
      generateChordProgression({
        root: pattern.root,
        scale: pattern.scale,
        progression: pattern.progression,
        beatsPerChord: pattern.beatsPerChord,
        voiceLead: pattern.voiceLead,
      }),
      { velocity: pattern.velocity, duration: pattern.duration }
    );
  }
  if (pattern.kind === 'scale') {
    return generateScale({
      root: pattern.root,
      scale: pattern.scale,
      octaves: pattern.octaves,
    }).map((note, index) => ({
      beat: index * (pattern.stepBeats ?? 0.5),
      note,
      velocity: pattern.velocity ?? 0.75,
      duration: pattern.duration ?? 0.45,
    }));
  }
  if (pattern.kind === 'chord') {
    return buildChord({ root: pattern.root, quality: pattern.quality }).map((note) => ({
      beat: pattern.beat ?? 0,
      note,
      velocity: pattern.velocity ?? 0.8,
      duration: pattern.duration ?? 1,
    }));
  }
  return Array.from(pattern.notes || []);
}

export function patternLengthBeats(notes = []) {
  return notes.reduce(
    (max, note) => Math.max(max, Number(note.beat || 0) + Number(note.duration || 0)),
    0
  );
}
