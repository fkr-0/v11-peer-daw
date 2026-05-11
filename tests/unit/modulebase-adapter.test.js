import { describe, expect, test } from '@jest/globals';
import { createLegacyModuleAdapter } from '../../src/core/modulebase-adapter.js';
import { ModuleBase, PortType } from '../../src/core/contracts.js';

class LegacyTone extends ModuleBase {
  constructor() {
    super({
      id: 'legacy-tone',
      title: 'Legacy Tone',
      kind: 'audio-source',
      inputs: [],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.started = false;
  }

  async start(context) {
    await super.start(context);
    this.started = true;
  }
}

describe('ModuleBase compatibility adapter', () => {
  test('wraps an old ModuleBase class as a runtime plugin', async () => {
    const plugin = createLegacyModuleAdapter({
      id: 'legacy-tone',
      name: 'Legacy Tone',
      version: '1.0.0',
      moduleClass: LegacyTone,
    });

    const instance = await plugin.create({ audioContext: { sampleRate: 48000 } });

    expect(plugin.manifest.ports.outputs).toEqual([{ id: 'audio', type: 'audio' }]);
    expect(instance.legacy.started).toBe(true);
    expect(instance.serialize()).toEqual({ id: 'legacy-tone', title: 'Legacy Tone', kind: 'audio-source' });
  });
});
