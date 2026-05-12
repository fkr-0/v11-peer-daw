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
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
  }
  connect(destination) {
    this.connections.push(destination);
  }
  disconnect() {
    this.connections = [];
  }
  start() {}
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
}

function fakeBuffer(samples) {
  return {
    duration: 1,
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
});
