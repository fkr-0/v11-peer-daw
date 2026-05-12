// V11 Peer DAW/tests/unit/effects-sampler-enhancements.test.js
// Behavior tests for richer effects and sampler waveform UX.

import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { CleanSamplerModule } from '../../src/modules/clean-sampler.js';
import { ReverbModule, TapeEchoModule } from '../../src/modules/effects.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setTargetAtTime(value, when, constant) {
    this.value = value;
    this.events.push(['setTargetAtTime', value, when, constant]);
  }
  setValueAtTime(value, when) {
    this.value = value;
    this.events.push(['setValueAtTime', value, when]);
  }
  linearRampToValueAtTime(value, when) {
    this.value = value;
    this.events.push(['linearRampToValueAtTime', value, when]);
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
    this.currentTime = 3;
    this.created = [];
  }
  createGain() {
    const node = new FakeNode('gain');
    node.gain = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createDelay(maxDelayTime = 1) {
    const node = new FakeNode('delay');
    node.maxDelayTime = maxDelayTime;
    node.delayTime = new FakeAudioParam(0);
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
  createOscillator() {
    const node = new FakeNode('oscillator');
    node.frequency = new FakeAudioParam(1);
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

function fakeBuffer(samples, duration = 1) {
  return {
    duration,
    length: samples.length,
    getChannelData() {
      return Float32Array.from(samples);
    },
  };
}

describe('effect module enhancements', () => {
  test('effects clamp parameters, update live audio params, and serialize state', async () => {
    const ctx = new FakeAudioContext();
    const echo = new TapeEchoModule({ id: 'echo-test' });
    await echo.start(ctx);

    echo.receive({ kind: PortType.CONTROL, type: 'param', target: 'feedback', value: 2 });
    echo.receive({ kind: PortType.CONTROL, type: 'param', target: 'rate', value: 4 });
    echo.receive({ kind: PortType.CONTROL, type: 'param', target: 'wet', value: 0.25 });

    expect(echo.feedback).toBe(0.95);
    expect(echo.rate).toBe(4);
    expect(echo.wet).toBe(0.25);
    expect(echo.nodes.feedback.gain.value).toBe(0.95);
    expect(echo.nodes.wet.gain.value).toBe(0.25);
    expect(echo.serialize()).toEqual({
      id: 'echo-test',
      title: 'Tape Echo',
      kind: 'audio-effect',
      params: { feedback: 0.95, rate: 4, wet: 0.25 },
    });
  });

  test('reverb exposes tone, size, and wet parameters as live controls', async () => {
    const ctx = new FakeAudioContext();
    const reverb = new ReverbModule({ id: 'reverb-test', wet: 0.2, size: 0.5, tone: 2400 });
    await reverb.start(ctx);

    reverb.receive({ kind: PortType.CONTROL, type: 'param', target: 'tone', value: 5000 });
    reverb.receive({ kind: PortType.CONTROL, type: 'param', target: 'size', value: 0.8 });

    expect(reverb.tone).toBe(5000);
    expect(reverb.size).toBe(0.8);
    expect(reverb.nodes.tone.frequency.value).toBe(5000);
    expect(reverb.nodes.feedback.gain.value).toBeCloseTo(0.56);
  });
});

describe('clean sampler waveform enhancement', () => {
  test('extracts normalized waveform peaks and renders them in the sampler UI', () => {
    const sampler = new CleanSamplerModule({ id: 'sampler-test' });
    sampler.buffer = fakeBuffer([0, 0.5, -1, 0.25, 0.75, -0.25, 0.1, -0.6]);
    sampler.fileName = 'loop.wav';

    expect(sampler.extractWaveformPeaks(4)).toEqual([0.5, 1, 0.75, 0.6]);
    const html = sampler.renderWaveform(4);

    expect(html).toContain('class="waveform sampler-waveform"');
    expect(html).toContain('aria-label="Waveform preview for loop.wav"');
    expect(html.match(/<i style="height:/g)).toHaveLength(4);
  });

  test('schedules time-shifted stretched pitched playback with an ADSR envelope', async () => {
    const ctx = new FakeAudioContext();
    const sampler = new CleanSamplerModule({
      id: 'sampler-transport-test',
      timeShift: 0.25,
      stretchRatio: 2,
      pitchSemitones: 12,
      pitchCents: -50,
      attack: 0.02,
      decay: 0.1,
      sustain: 0.4,
      release: 0.3,
    });
    await sampler.start(ctx);
    sampler.buffer = fakeBuffer([0, 0.5, -0.5, 0.25], 2);

    sampler.play('C4', 0.8, 5);

    const source = ctx.created.find((node) => node.kind === 'bufferSource');
    const amp = ctx.created.filter((node) => node.kind === 'gain').at(-1);
    expect(source.buffer).toBe(sampler.buffer);
    expect(source.playbackRate.value).toBeCloseTo(0.9715, 4);
    expect(source.started[0]).toEqual([5, 0.25, 1.75]);
    expect(source.stopped[0][0]).toBeCloseTo(8.85);
    expect(amp.gain.events).toEqual([
      ['setValueAtTime', 0.0001, 5],
      ['linearRampToValueAtTime', 0.8, 5.02],
      ['linearRampToValueAtTime', 0.32000000000000006, 5.119999999999999],
      ['setTargetAtTime', 0.0001, 8.5, 0.3],
    ]);
  });

  test('accepts sampler transport, pitch, and ADSR control params and serializes them', () => {
    const sampler = new CleanSamplerModule({ id: 'sampler-param-test' });

    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'timeShift', value: 0.4 });
    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'stretchRatio', value: 0 });
    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'pitchSemitones', value: -7 });
    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'attack', value: 0.05 });
    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'decay', value: 0.2 });
    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'sustain', value: 1.4 });
    sampler.receive({ kind: PortType.CONTROL, type: 'param', target: 'release', value: 0.5 });

    expect(sampler.timeShift).toBe(0.4);
    expect(sampler.stretchRatio).toBe(0.25);
    expect(sampler.pitchSemitones).toBe(-7);
    expect(sampler.attack).toBe(0.05);
    expect(sampler.decay).toBe(0.2);
    expect(sampler.sustain).toBe(1);
    expect(sampler.release).toBe(0.5);
    expect(sampler.serialize()).toEqual({
      id: 'sampler-param-test',
      title: 'Clean Sampler',
      kind: 'audio-source',
      fileName: 'drop or choose an audio sample',
      params: {
        attack: 0.05,
        decay: 0.2,
        pitchCents: 0,
        pitchSemitones: -7,
        release: 0.5,
        rootNote: 'C4',
        stretchRatio: 0.25,
        sustain: 1,
        timeShift: 0.4,
      },
    });
  });
});
