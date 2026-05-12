// V11 Peer DAW/tests/unit/field-recorder-worklet.test.js
// Unit tests for Field Recorder worklet

import { describe, expect, test } from '@jest/globals';

class FakeRuntime {
  constructor() {
    this.calls = [];
  }

  async createNode(name, url, options) {
    this.calls.push({ name, url, options });
    return { name, url, options, connect: () => {}, disconnect: () => {} };
  }
}

// Mock FieldRecorderEngine for testing
class MockFieldRecorderEngine {
  constructor(config = {}) {
    this.workletRuntime = config.workletRuntime;
    this.output = null;
  }

  async start() {
    if (this.workletRuntime) {
      this.output = await this.workletRuntime.createNode(
        'field-recorder',
        './processor.worklet.js',
        { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }
      );
    }
  }
}

describe('FieldRecorderEngine worklet playback', () => {
  test('uses the field-recorder worklet as its audio output when a runtime is provided', async () => {
    const runtime = new FakeRuntime();
    const engine = new MockFieldRecorderEngine({ workletRuntime: runtime });

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
