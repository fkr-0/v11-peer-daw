// V11 Peer DAW/src/core/grid-state.js
// Pure helpers for grid-cell identity and note/MIDI conversion.

export function gridCellKey(data = {}) {
  return [
    data.gridKind,
    data.moduleId,
    data.rowId || data.note || data.rowIndex || '',
    data.stepIndex ?? data.step ?? data.colIndex ?? '',
  ].join(':');
}

export function gridDataFromKey(key = '') {
  const [gridKind, moduleId, rowOrNote, step] = String(key).split(':');
  return {
    gridKind,
    moduleId,
    rowId: rowOrNote,
    note: rowOrNote,
    rowIndex: rowOrNote,
    stepIndex: step,
    step,
    colIndex: step,
  };
}

export function selectedGridData(selection = new Set()) {
  return [...selection].map((key) => gridDataFromKey(key));
}

export function noteNameToMidi(note = 'C4') {
  const match = String(note)
    .trim()
    .match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return 60;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()] ?? 0;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + base + accidental;
}

export function midiToNoteName(midi = 60) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const value = Math.max(0, Math.min(127, Math.round(Number(midi) || 60)));
  return `${names[value % 12]}${Math.floor(value / 12) - 1}`;
}
