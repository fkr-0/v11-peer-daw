import { describe, expect, test } from '@jest/globals';
import { PluginLoader } from '../../src/core/plugin-loader.js';

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
    const loader = new PluginLoader({ importModule: async () => shell });

    const plugin = await loader.load('./field-recorder/index.js');

    expect(plugin.manifest.id).toBe('field-recorder');
    expect(typeof plugin.create).toBe('function');
  });
});
