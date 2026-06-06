import { describe, expect, test } from '@jest/globals';
import { moduleFactories } from '../../src/modules/catalog.js';

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

class FakeAudioNode {
  constructor(kind = 'node') {
    this.kind = kind;
    this.type = kind;
    this.connections = [];
    this.started = [];
    this.stopped = [];
    this.gain = new FakeAudioParam(1);
    this.delayTime = new FakeAudioParam(0);
    this.frequency = new FakeAudioParam(440);
    this.Q = new FakeAudioParam(1);
    this.detune = new FakeAudioParam(0);
    this.playbackRate = new FakeAudioParam(1);
    this.pan = new FakeAudioParam(0);
  }
  connect(destination) {
    this.connections.push(destination);
    return destination;
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
  setPeriodicWave(wave) {
    this.periodicWave = wave;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 44100;
    this.destination = new FakeAudioNode('destination');
    this.created = [];
  }
  node(kind) {
    const node = new FakeAudioNode(kind);
    this.created.push(node);
    return node;
  }
  createGain() {
    return this.node('gain');
  }
  createDelay() {
    return this.node('delay');
  }
  createBiquadFilter() {
    return this.node('biquad');
  }
  createOscillator() {
    return this.node('oscillator');
  }
  createBufferSource() {
    return this.node('bufferSource');
  }
  createStereoPanner() {
    return this.node('stereoPanner');
  }
  createWaveShaper() {
    return this.node('waveShaper');
  }
  createConvolver() {
    return this.node('convolver');
  }
  createDynamicsCompressor() {
    return this.node('compressor');
  }
  createAnalyser() {
    return this.node('analyser');
  }
  createBuffer(numberOfChannels = 1, length = 128, sampleRate = this.sampleRate) {
    return {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData() {
        return new Float32Array(length);
      },
    };
  }
  createPeriodicWave(real, imag) {
    return { real, imag };
  }
  async decodeAudioData() {
    return this.createBuffer(1, 128, this.sampleRate);
  }
}

function fakeRoot() {
  const element = {
    value: '',
    checked: false,
    width: 0,
    height: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    style: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    getContext() {
      return {
        canvas: element,
        fillRect() {},
        strokeRect() {},
        fillText() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        clearRect() {},
        save() {},
        restore() {},
        measureText() {
          return { width: 8 };
        },
      };
    },
    querySelector() {
      return element;
    },
    querySelectorAll() {
      return [];
    },
  };
  return {
    innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    querySelector() {
      return element;
    },
    querySelectorAll() {
      return [];
    },
  };
}

describe('module factory lifecycle conformance', () => {
  test('all catalog modules tolerate mount/start/serialize/hydrate/audio teardown lifecycle', async () => {
    const failures = [];

    for (const [key, factory] of Object.entries(moduleFactories)) {
      try {
        const module = factory();
        const root = fakeRoot();
        const context = new FakeAudioContext();
        const destination = context.createGain();

        module.mount?.(root);
        await module.start?.(context);
        await module.start?.(context);
        const serialized = module.serialize?.();
        expect(serialized).toEqual(
          expect.objectContaining({ id: module.id, title: module.title, kind: module.kind })
        );
        module.hydrate?.(serialized);
        module.connectAudio?.(destination);
        module.disconnectAudio?.();
        module.stop?.();
        module.unmount?.();
        expect(root.innerHTML).toBe('');
      } catch (error) {
        failures.push(`${key}: ${error.message}`);
      }
    }

    expect(failures).toEqual([]);
  });

  test('all catalog modules escape untrusted titles when rendering HTML', async () => {
    const failures = [];
    const hostileTitle = '<unsafe title data-risk="1">';

    for (const [key, factory] of Object.entries(moduleFactories)) {
      try {
        const module = factory();
        const root = fakeRoot();
        module.title = hostileTitle;
        module.fileName = hostileTitle;
        module.lastPilot = 'pilot" quoted';
        module.status = '<offline status>';
        module.mount?.(root);

        expect(root.innerHTML).not.toContain('<unsafe title');
        expect(root.innerHTML).not.toContain('<offline status>');
        expect(root.innerHTML).not.toContain('pilot" quoted');
      } catch (error) {
        failures.push(`${key}: ${error.message}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
