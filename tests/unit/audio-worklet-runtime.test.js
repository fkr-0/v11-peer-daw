import { describe, expect, test } from '@jest/globals';
import { AudioWorkletRuntime } from '../../src/core/dsp/audio-worklet-runtime.js';

describe('AudioWorkletRuntime', () => {
  test('registers each processor URL once per audio context', async () => {
    const added = [];
    const context = {
      audioWorklet: {
        addModule: async (url) => added.push(url),
      },
    };
    const runtime = new AudioWorkletRuntime(context);

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
    const runtime = new AudioWorkletRuntime(context);

    const node = await runtime.createNode('field-recorder', './processor.worklet.js', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    expect(node.name).toBe('field-recorder');
    expect(created[0].options.outputChannelCount).toEqual([2]);
  });
});
