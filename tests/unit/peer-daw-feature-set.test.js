// V11 Peer DAW/tests/unit/peer-daw-feature-set.test.js
// Consolidated peer DAW feature-set tests.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { moduleFactories, requiredPeerDawModules } from '../../src/modules/catalog.js';
import { MultiSamplerModule } from '../../src/modules/multisampler.js';
import { DrumSynthModule, PolySynthModule } from '../../src/modules/synths.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(value, when) {
    this.value = value;
    this.events.push(['setValueAtTime', value, when]);
  }
  exponentialRampToValueAtTime(value, when) {
    this.value = value;
    this.events.push(['exponentialRampToValueAtTime', value, when]);
  }
  setTargetAtTime(value, when, constant) {
    this.value = value;
    this.events.push(['setTargetAtTime', value, when, constant]);
  }
  cancelScheduledValues(when) {
    this.events.push(['cancelScheduledValues', when]);
  }
}

class FakeNode {
  constructor(type) {
    this.kind = type;
    this.type = type;
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
    this.currentTime = 1;
    this.created = [];
  }
  createGain() {
    const node = new FakeNode('gain');
    node.gain = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeNode('oscillator');
    node.frequency = new FakeAudioParam(440);
    node.detune = new FakeAudioParam(0);
    this.created.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeNode('biquad');
    node.frequency = new FakeAudioParam(1000);
    node.Q = new FakeAudioParam(1);
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

function fakeBuffer(duration = 2, length = 96) {
  return {
    duration,
    length,
    getChannelData() {
      return Float32Array.from({ length }, (_, index) => Math.sin(index / 4));
    },
  };
}

describe('consolidated V11 peer DAW catalog', () => {
  test('exposes one canonical factory catalog for required DAW modules', () => {
    expect(requiredPeerDawModules).toEqual(
      expect.arrayContaining([
        'ocra',
        'sampler',
        'sequencer',
        'wiring',
        'effects',
        'master',
        'polysynth',
        'drumsynth',
        'multisampler',
      ])
    );

    for (const key of requiredPeerDawModules) {
      expect(typeof moduleFactories[key]).toBe('function');
      const module = moduleFactories[key]();
      expect(module.id).toBeTruthy();
      expect(module.title).toBeTruthy();
      expect(Array.isArray(module.inputs)).toBe(true);
      expect(Array.isArray(module.outputs)).toBe(true);
    }
  });

  test('module bay exposes the required feature-set modules to users', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    for (const key of requiredPeerDawModules) {
      expect(html).toContain(`value="${key}"`);
    }
  });
});

describe('synth modules', () => {
  test('poly synth keeps independent voices and releases the requested note', async () => {
    const ctx = new FakeAudioContext();
    const synth = new PolySynthModule({ id: 'poly-test' });
    await synth.start(ctx);

    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C4', velocity: 0.5 });
    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'E4', velocity: 0.7 });

    expect(synth.voices.size).toBe(2);
    expect(ctx.created.filter((node) => node.kind === 'oscillator')).toHaveLength(4);

    synth.receive({ kind: PortType.MIDI, type: 'note-off', note: 'C4' });

    expect(synth.voices.has('C4')).toBe(false);
    expect(synth.voices.has('E4')).toBe(true);
  });

  test('drum synth maps notes to percussive voices', async () => {
    const ctx = new FakeAudioContext();
    const drum = new DrumSynthModule({ id: 'drum-test' });
    await drum.start(ctx);

    drum.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C1', velocity: 0.9 });
    drum.receive({ kind: PortType.MIDI, type: 'note-on', note: 'D1', velocity: 0.6 });

    expect(drum.lastHits.map((hit) => hit.voice)).toEqual(['kick', 'snare']);
    expect(ctx.created.some((node) => node.kind === 'oscillator')).toBe(true);
    expect(ctx.created.some((node) => node.kind === 'biquad')).toBe(true);
  });
});

describe('multisampler module', () => {
  test('maps multiple zones, slices playback, and serializes sample layout', async () => {
    const ctx = new FakeAudioContext();
    const sampler = new MultiSamplerModule({ id: 'multi-test', sliceCount: 4 });
    await sampler.start(ctx);

    sampler.addSampleZone({
      name: 'bass.wav',
      rootNote: 'C2',
      minNote: 'C1',
      maxNote: 'B2',
      buffer: fakeBuffer(4),
    });
    sampler.addSampleZone({
      name: 'lead.wav',
      rootNote: 'C5',
      minNote: 'C3',
      maxNote: 'C7',
      buffer: fakeBuffer(8),
    });

    sampler.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C5', velocity: 0.8, slice: 2 });

    const source = ctx.created.find((node) => node.kind === 'bufferSource');
    expect(source.playbackRate.value).toBeCloseTo(1);
    expect(source.started[0]).toEqual([1.015, 4, 1.96]);
    expect(sampler.serialize().zones).toEqual([
      { name: 'bass.wav', rootNote: 'C2', minNote: 'C1', maxNote: 'B2' },
      { name: 'lead.wav', rootNote: 'C5', minNote: 'C3', maxNote: 'C7' },
    ]);
  });
});
