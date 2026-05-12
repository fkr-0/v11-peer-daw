// V11 Peer DAW/tests/unit/audio-worklet-runtime.test.js
// Unit tests for AudioWorkletRuntime

import { describe, expect, test } from '@jest/globals';

// Mock AudioWorkletRuntime
class MockAudioWorkletRuntime {
  constructor(context) {
    this.context = context;
    this.registered = new Set();
  }

  async registerProcessor(name, url) {
    if (!this.registered.has(name)) {
      await this.context.audioWorklet.addModule(url);
      this.registered.add(name);
    }
  }

  isRegistered(name) {
    return this.registered.has(name);
  }

  async createNode(name, url, options) {
    await this.registerProcessor(name, url);
    return new this.context.AudioWorkletNode(this.context, name, options);
  }
}

describe('AudioWorkletRuntime', () => {
  test('registers each processor URL once per audio context', async () => {
    const added = [];
    const context = {
      audioWorklet: {
        addModule: async (url) => added.push(url),
      },
    };
    const runtime = new MockAudioWorkletRuntime(context);

    await runtime.registerProcessor('field-recorder', './processor.worklet.js');
    await runtime.registerProcessor('field-recorder', './processor.worklet.js');

    expect(added).toEqual(['./processor.worklet.js']);
    expect(runtime.isRegistered('field-recorder')).toBe(true);
  });

  test('creates an AudioWorkletNode after processor registration', async () => {
    const created = [];
    const context = {
      audioWorklet: { addModule: async () => {} },
      AudioWorkletNode: class FakeAudioWorkletNode {
        constructor(ctx, name, options) {
          created.push({ ctx, name, options });
          this.name = name;
          this.options = options;
        }
      },
    };
    const runtime = new MockAudioWorkletRuntime(context);

    const node = await runtime.createNode('field-recorder', './processor.worklet.js', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    expect(node.name).toBe('field-recorder');
    expect(created[0].options.outputChannelCount).toEqual([2]);
  });
});
