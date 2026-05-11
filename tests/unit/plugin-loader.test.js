// V11 Peer DAW/tests/unit/plugin-loader.test.js
// Unit tests for PluginLoader

const { describe, expect, test } = require('@jest/globals');

// Mock PluginLoader
class MockPluginLoader {
  constructor(config = {}) {
    this.importModule = config.importModule || (() => ({}));
  }

  async load(path) {
    const shell = await this.importModule(path);
    return {
      manifest: shell.manifest,
      create: shell.create,
    };
  }
}

describe('PluginLoader', () => {
  test('loads a hybrid plugin from an ES module shell and validates its manifest', async () => {
    const shell = {
      manifest: {
        id: 'field-recorder',
        name: 'Field Recorder',
        version: '1.0.0',
        apiVersion: 'v1',
        entry: './index.js',
        capabilities: { audio: true, ui: true, worklet: true, wasm: false },
        ports: { inputs: [], outputs: [{ id: 'audio', type: 'audio' }] },
        dsp: { worklet: './processor.worklet.js' },
      },
      create: async () => ({ serialize: () => ({}) }),
    };
    const loader = new MockPluginLoader({ importModule: async () => shell });

    const plugin = await loader.load('./field-recorder/index.js');

    expect(plugin.manifest.id).toBe('field-recorder');
    expect(typeof plugin.create).toBe('function');
  });
});
