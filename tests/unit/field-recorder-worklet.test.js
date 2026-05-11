import { describe, expect, test } from '@jest/globals';
import { FieldRecorderEngine } from '../../src/modules/field-recorder/engine.js';

class FakeRuntime {
  constructor() {
    this.calls = [];
  }

  async createNode(name, url, options) {
    this.calls.push({ name, url, options });
    return { name, url, options, connect: () => {}, disconnect: () => {} };
  }
}

describe('FieldRecorderEngine worklet playback', () => {
  test('uses the field-recorder worklet as its audio output when a runtime is provided', async () => {
    const runtime = new FakeRuntime();
    const engine = new FieldRecorderEngine({ workletRuntime: runtime });

    await engine.start();

    expect(runtime.calls).toEqual([
      {
        name: 'field-recorder',
        url: './processor.worklet.js',
        options: { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] },
      },
    ]);
    expect(engine.output.name).toBe('field-recorder');
  });
});
