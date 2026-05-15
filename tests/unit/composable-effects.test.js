// V11 Peer DAW/tests/unit/composable-effects.test.js
// Audio effect modules should be composable audio-in/audio-out processors.

import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { moduleFactories } from '../../src/modules/catalog.js';
import {
  BeatRepeatModule,
  DelayModule,
  DubEchoModule,
  FlangerModule,
  GrainDelayModule,
  PhaserModule,
  PitchShiftModule,
  ReverbModule,
} from '../../src/modules/effects.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
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

const composableEffectCases = [
  ['reverb', ReverbModule],
  ['delay', DelayModule],
  ['dubecho', DubEchoModule],
  ['phaser', PhaserModule],
  ['beatrepeat', BeatRepeatModule],
  ['graindelay', GrainDelayModule],
  ['flanger', FlangerModule],
  ['pitchshift', PitchShiftModule],
];

describe('composable effect modules', () => {
  test.each(composableEffectCases)('%s exposes audio input/output and can be chained', async (_key, EffectClass) => {
    const ctx = new FakeAudioContext();
    const effect = new EffectClass({ id: `${_key}-test` });
    const destination = new FakeNode('destination');

    await effect.start(ctx);
    effect.connectAudio(destination);

    expect(effect.kind).toBe('audio-effect');
    expect(effect.inputs).toEqual(expect.arrayContaining([{ id: 'audio', type: PortType.AUDIO }]));
    expect(effect.outputs).toEqual([{ id: 'audio', type: PortType.AUDIO }]);
    expect(effect.input).toBeTruthy();
    expect(effect.output).toBeTruthy();
    expect(effect.output.connections).toContain(destination);
    expect(effect.serialize()).toEqual(
      expect.objectContaining({ id: `${_key}-test`, kind: 'audio-effect', params: expect.any(Object) })
    );
  });

  test('new effects are exposed by the module catalog', () => {
    for (const key of ['delay', 'beatrepeat', 'graindelay', 'pitchshift']) {
      expect(typeof moduleFactories[key]).toBe('function');
      expect(moduleFactories[key]().kind).toBe('audio-effect');
    }
  });

  test('delay, grain-delay, and pitch-shift update live params from control packets', async () => {
    const ctx = new FakeAudioContext();
    const delay = new DelayModule({ id: 'delay-param-test' });
    const grain = new GrainDelayModule({ id: 'grain-param-test' });
    const pitch = new PitchShiftModule({ id: 'pitch-param-test' });

    await delay.start(ctx);
    await grain.start(ctx);
    await pitch.start(ctx);

    delay.receive({ kind: PortType.CONTROL, type: 'param', target: 'time', value: 0.75 });
    grain.receive({ kind: PortType.CONTROL, type: 'param', target: 'grainSize', value: 0.09 });
    pitch.receive({ kind: PortType.CONTROL, type: 'param', target: 'semitones', value: -7 });

    expect(delay.nodes.delay.delayTime.value).toBe(0.75);
    expect(grain.nodes.grain.delayTime.value).toBe(0.09);
    expect(pitch.nodes.shiftA.delayTime.value).toBeGreaterThan(0);
    expect(pitch.semitones).toBe(-7);
  });
});
