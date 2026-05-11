import { describe, expect, test } from '@jest/globals';
import { PluginLoader } from '../../src/core/plugin-loader.js';
import { SharedAudioTransport } from '../../src/core/dsp/shared-audio-transport.js';
import { create, manifest } from '../../src/modules/field-recorder/index.js';

describe('field recorder runtime plugin', () => {
  test('exports a valid hybrid plugin manifest loadable by PluginLoader', async () => {
    const loader = new PluginLoader({ importModule: async () => ({ manifest, create }) });

    const plugin = await loader.load('./field-recorder/index.js');

    expect(plugin.manifest.id).toBe('field-recorder');
    expect(plugin.manifest.capabilities.worklet).toBe(true);
    expect(plugin.manifest.dsp.worklet).toBe('./processor.worklet.js');
    expect(typeof plugin.create).toBe('function');
  });

  test('creates an instance with engine, params, shared transport, and serializable recorder state', async () => {
    const workletCalls = [];
    const instance = await create({
      workletRuntime: {
        createNode: async (name, url, options) => {
          workletCalls.push({ name, url, options });
          return { port: { postMessage: () => {} }, connect: () => {}, disconnect: () => {} };
        },
      },
      transportFactory: () => SharedAudioTransport.create({ frameCapacity: 8, channels: 2 }),
    });

    await instance.start();

    expect(workletCalls[0].name).toBe('field-recorder');
    expect(instance.params.get('gain')).toBe(0.6);
    expect(instance.transport.descriptor.channels).toBe(2);
    expect(instance.serialize()).toEqual({ id: 'field-recorder', fileName: 'no sample loaded', params: { gain: 0.6 } });
  });
});
