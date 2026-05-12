// V11 Peer DAW/tests/unit/drum-sampler-piano-roll.test.js
// Drum sampler and piano-roll clip behavior.

import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { createDefaultPeerDawRig, moduleFactories } from '../../src/modules/catalog.js';
import { DrumSamplerModule } from '../../src/modules/drum-sampler.js';
import { PianoRollModule } from '../../src/modules/piano-roll.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(value, when) {
    this.value = value;
    this.events.push(['setValueAtTime', value, when]);
  }
  linearRampToValueAtTime(value, when) {
    this.value = value;
    this.events.push(['linearRampToValueAtTime', value, when]);
  }
  setTargetAtTime(value, when, constant) {
    this.value = value;
    this.events.push(['setTargetAtTime', value, when, constant]);
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
    this.started = [];
    this.stopped = [];
  }
  connect(destination) {
    this.connections.push(destination);
  }
  disconnect() {
    this.connections = [];
  }
  start(...args) {
    this.started.push(args);
  }
  stop(...args) {
    this.stopped.push(args);
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 4;
    this.created = [];
  }
  createGain() {
    const node = new FakeNode('gain');
    node.gain = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeNode('bufferSource');
    node.playbackRate = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
}

function fakeBuffer(duration = 0.5) {
  return {
    duration,
    length: 32,
    getChannelData() {
      return Float32Array.from({ length: 32 }, (_, index) => Math.sin(index));
    },
  };
}

describe('dedicated drum sampler', () => {
  test('assigns pads, triggers by MIDI note, applies velocity envelope, and serializes pad map', async () => {
    const ctx = new FakeAudioContext();
    const sampler = new DrumSamplerModule({
      id: 'drum-test',
      swing: 'swing62',
      swingResolution: '1/8',
    });
    await sampler.start(ctx);
    sampler.assignPad('kick', {
      note: 'C1',
      name: 'kick.wav',
      buffer: fakeBuffer(0.6),
      chokeGroup: 'drums',
    });

    sampler.receive({
      kind: PortType.MIDI,
      type: 'note-on',
      note: 'C1',
      velocity: 0.7,
      audioTime: 5,
    });

    const source = ctx.created.find((node) => node.kind === 'bufferSource');
    const amp = ctx.created.filter((node) => node.kind === 'gain').at(-1);
    expect(source.buffer.duration).toBe(0.6);
    expect(source.started[0]).toEqual([5, 0, 0.6]);
    expect(source.stopped[0][0]).toBeCloseTo(5.67);
    expect(amp.gain.events).toEqual([
      ['setValueAtTime', 0.0001, 5],
      ['linearRampToValueAtTime', 0.7, 5.005],
      ['setTargetAtTime', 0.0001, 5.6, 0.02],
    ]);
    expect(sampler.serialize()).toEqual({
      id: 'drum-test',
      title: 'Drum Sampler',
      kind: 'audio-source',
      swing: 'swing62',
      swingResolution: '1/8',
      pads: [
        { id: 'kick', note: 'C1', name: 'kick.wav', chokeGroup: 'drums', gain: 1, pan: 0 },
        { id: 'snare', note: 'D1', name: 'Snare', chokeGroup: 'drums', gain: 1, pan: 0 },
        { id: 'hat', note: 'F#1', name: 'Closed Hat', chokeGroup: 'hats', gain: 0.85, pan: 0 },
        { id: 'openhat', note: 'A#1', name: 'Open Hat', chokeGroup: 'hats', gain: 0.85, pan: 0 },
      ],
    });
  });
});

describe('piano roll clip velocity and MPC swing', () => {
  test('destructively applies MPC swing to note beats at selected resolution', () => {
    const roll = new PianoRollModule({
      id: 'roll-test',
      lengthBeats: 2,
      notes: [
        { id: 'hat-0', beat: 0, note: 'F#1', velocity: 0.4, duration: 0.1 },
        { id: 'hat-1', beat: 0.5, note: 'F#1', velocity: 0.4, duration: 0.1 },
        { id: 'hat-2', beat: 1, note: 'F#1', velocity: 0.4, duration: 0.1 },
        { id: 'hat-3', beat: 1.5, note: 'F#1', velocity: 0.4, duration: 0.1 },
      ],
    });

    roll.applySwingToClip({ amount: 'swing60', resolution: '1/8' });

    expect(roll.notes.map((note) => note.beat)).toEqual([0, 0.6, 1, 1.6]);
    expect(roll.swing).toEqual({ amount: 'swing60', resolution: '1/8' });
  });

  test('emits MIDI and control events with note velocity from the roll', () => {
    const roll = new PianoRollModule({
      id: 'roll-output-test',
      stepResolutionBeats: 0.25,
      notes: [
        { id: 'kick', beat: 0.5, note: 'C1', velocity: 0.91, duration: 0.2 },
        {
          id: 'cutoff',
          beat: 0.5,
          kind: PortType.CONTROL,
          type: 'param',
          target: 'filter.frequency',
          value: 900,
        },
      ],
    });
    const emitted = [];
    roll.addEventListener('packet', (event) => emitted.push(event.detail));

    roll.receive({ kind: PortType.CLOCK, type: 'step', step: 2, at: 10, bpm: 120 });

    expect(emitted).toEqual([
      {
        module: roll,
        outputId: 'midi',
        packet: {
          kind: 'midi',
          type: 'note-on',
          at: 10,
          channel: 'main',
          note: 'C1',
          velocity: 0.91,
          gate: 0.2,
        },
      },
      {
        module: roll,
        outputId: 'midi',
        packet: {
          kind: 'midi',
          type: 'note-off',
          at: 10.2,
          channel: 'main',
          note: 'C1',
          velocity: 0,
        },
      },
      {
        module: roll,
        outputId: 'control',
        packet: { kind: 'control', type: 'param', at: 10, target: 'filter.frequency', value: 900 },
      },
    ]);
  });
});

describe('default loaded sample project', () => {
  test('catalog exposes drum sampler and default rig loads a two-bar piano-roll drum loop routed by app', () => {
    expect(moduleFactories.drumsampler()).toBeInstanceOf(DrumSamplerModule);

    const rig = createDefaultPeerDawRig({ destination: {}, setMasterVolume() {} });

    expect(rig.drumSampler).toBeInstanceOf(DrumSamplerModule);
    expect(rig.drumPianoRoll).toBeInstanceOf(PianoRollModule);
    expect(rig.drumPianoRoll.lengthBeats).toBe(8);
    expect(rig.drumPianoRoll.notes.filter((note) => note.note === 'F#1')).toHaveLength(16);
    expect(
      rig.drumPianoRoll.notes.filter((note) => note.note === 'C1').map((note) => note.beat)
    ).toEqual([0, 4, 5]);
    expect(
      rig.drumPianoRoll.notes.filter((note) => note.note === 'D1').map((note) => note.beat)
    ).toEqual([2, 6]);
  });
});
