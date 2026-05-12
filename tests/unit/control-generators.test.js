// V11 Peer DAW/tests/unit/control-generators.test.js
// Rich control-data generators: step sequencer conversion and arpeggiator transforms.

import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import {
  CONVERTIBLE_TO_PIANOROLL,
  convertToPianoRollConfig,
  isConvertibleToPianoRoll,
} from '../../src/core/convertible-to-pianoroll.js';
import {
  ArpMidiGeneratorModule,
  BasicSequencerModule,
} from '../../src/modules/advanced-sequencer.js';
import { PianoRollModule } from '../../src/modules/piano-roll.js';

describe('step sequencer control generator', () => {
  test('supports fixed clip lengths, row note mappings, per-step velocity, and micro-timing', () => {
    const seq = new BasicSequencerModule({
      id: 'seq-test',
      length: 8,
      rows: [
        {
          id: 'kick',
          note: 'C1',
          steps: [
            { enabled: true, velocity: 0.9, microTiming: -0.05, duration: 0.25 },
            { enabled: false },
          ],
        },
        {
          id: 'snare',
          note: 'D1',
          steps: Array.from({ length: 8 }, (_, step) => ({
            enabled: step === 2,
            velocity: 0.75,
            microTiming: 0.04,
            duration: 0.5,
          })),
        },
      ],
    });
    const emitted = [];
    seq.addEventListener('packet', (event) => emitted.push(event.detail));

    seq.receive({ kind: PortType.CLOCK, type: 'step', step: 0, at: 10, bpm: 120 });
    seq.receive({ kind: PortType.CLOCK, type: 'step', step: 2, at: 10.25, bpm: 120 });

    expect(seq.length).toBe(8);
    expect(seq.rows[0].steps).toHaveLength(8);
    expect(emitted.map((event) => event.packet)).toEqual([
      {
        kind: 'midi',
        type: 'note-on',
        at: 9.975,
        channel: 'main',
        note: 'C1',
        velocity: 0.9,
        gate: 0.125,
        microTiming: -0.05,
      },
      {
        kind: 'midi',
        type: 'note-off',
        at: 10.1,
        channel: 'main',
        note: 'C1',
        velocity: 0,
      },
      {
        kind: 'midi',
        type: 'note-on',
        at: 10.27,
        channel: 'main',
        note: 'D1',
        velocity: 0.75,
        gate: 0.25,
        microTiming: 0.04,
      },
      {
        kind: 'midi',
        type: 'note-off',
        at: 10.52,
        channel: 'main',
        note: 'D1',
        velocity: 0,
      },
    ]);
  });

  test('implements convertible-to-pianoroll and creates a replacement piano-roll config', () => {
    const seq = new BasicSequencerModule({
      id: 'seq-convert',
      title: 'Drum Grid',
      length: 4,
      stepResolutionBeats: 0.5,
      rows: [
        {
          id: 'kick',
          label: 'Kick',
          note: 'C1',
          steps: [
            { enabled: true, velocity: 1, microTiming: 0, duration: 0.25 },
            { enabled: true, velocity: 0.7, microTiming: 0.1, duration: 0.5 },
          ],
        },
      ],
    });

    expect(seq[CONVERTIBLE_TO_PIANOROLL]).toBe(true);
    expect(isConvertibleToPianoRoll(seq)).toBe(true);
    expect(convertToPianoRollConfig(seq)).toEqual({
      id: 'seq-convert-piano-roll',
      title: 'Drum Grid Piano Roll',
      lengthBeats: 2,
      stepResolutionBeats: 0.5,
      notes: [
        { id: 'kick-1', beat: 0, note: 'C1', velocity: 1, duration: 0.125, sourceRow: 'kick' },
        { id: 'kick-2', beat: 0.6, note: 'C1', velocity: 0.7, duration: 0.25, sourceRow: 'kick' },
      ],
    });

    const pianoRoll = seq.convertToPianoRoll();
    expect(pianoRoll).toBeInstanceOf(PianoRollModule);
    expect(pianoRoll.notes.map((note) => note.beat)).toEqual([0, 0.6]);
  });
});

describe('arpeggiator control generator', () => {
  test('receives MIDI notes and arpeggiates transformed notes on clock ticks', () => {
    const arp = new ArpMidiGeneratorModule({
      id: 'arp-test',
      scale: 'minor',
      interval: 'tritone',
      stepSize: 2,
      noteLength: 0.25,
      repeat: 2,
      repeatInverse: true,
    });
    const emitted = [];
    arp.addEventListener('packet', (event) => emitted.push(event.detail.packet));

    arp.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C3', velocity: 0.8 });
    arp.receive({ kind: PortType.MIDI, type: 'note-on', note: 'E3', velocity: 0.6 });
    arp.receive({ kind: PortType.CONTROL, type: 'param', target: 'octaves', value: 2 });
    arp.receive({ kind: PortType.CLOCK, type: 'step', step: 0, at: 20, bpm: 120 });
    arp.receive({ kind: PortType.CLOCK, type: 'step', step: 1, at: 20.25, bpm: 120 });
    arp.receive({ kind: PortType.CLOCK, type: 'step', step: 2, at: 20.5, bpm: 120 });

    expect(arp.notes).toEqual(['C3', 'E3']);
    expect(emitted).toEqual([
      {
        kind: 'midi',
        type: 'note-on',
        at: 20,
        channel: 'main',
        note: 'C3',
        velocity: 0.8,
        gate: 0.125,
      },
      { kind: 'midi', type: 'note-off', at: 20.125, channel: 'main', note: 'C3', velocity: 0 },
      {
        kind: 'midi',
        type: 'note-on',
        at: 20.25,
        channel: 'main',
        note: 'F#3',
        velocity: 0.8,
        gate: 0.125,
      },
      { kind: 'midi', type: 'note-off', at: 20.375, channel: 'main', note: 'F#3', velocity: 0 },
      {
        kind: 'midi',
        type: 'note-on',
        at: 20.5,
        channel: 'main',
        note: 'C4',
        velocity: 0.8,
        gate: 0.125,
      },
      { kind: 'midi', type: 'note-off', at: 20.625, channel: 'main', note: 'C4', velocity: 0 },
    ]);
  });

  test('serializes UX-facing arp settings and responds to note-off', () => {
    const arp = new ArpMidiGeneratorModule({ id: 'arp-serialize', scale: 'chromatic' });

    arp.receive({ kind: PortType.MIDI, type: 'note-on', note: 'A2', velocity: 0.5 });
    arp.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C3', velocity: 0.9 });
    arp.receive({ kind: PortType.MIDI, type: 'note-off', note: 'A2' });
    arp.receive({ kind: PortType.CONTROL, type: 'param', target: 'stepSize', value: 3 });

    expect(arp.notes).toEqual(['C3']);
    expect(arp.serialize()).toEqual({
      id: 'arp-serialize',
      title: 'ARP MIDI Generator',
      kind: 'midi-generator',
      settings: {
        direction: 'up',
        interval: 'scale',
        noteLength: 0.25,
        octaves: 1,
        repeat: 1,
        repeatInverse: false,
        scale: 'chromatic',
        stepSize: 3,
      },
      notes: ['C3'],
    });
  });
});
