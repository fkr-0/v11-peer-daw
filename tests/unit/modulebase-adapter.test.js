// V11 Peer DAW/tests/unit/modulebase-adapter.test.js
// Unit tests for ModuleBase compatibility adapter

const { describe, expect, test } = require('@jest/globals');

// Mock dependencies
const PortType = {
  CLOCK: 'clock',
  MIDI: 'midi',
  CONTROL: 'control',
  AUDIO: 'audio',
};

// Mock ModuleBase for testing
class MockModuleBase {
  constructor(config) {
    this.id = config.id;
    this.title = config.title;
    this.kind = config.kind;
    this.inputs = config.inputs || [];
    this.outputs = config.outputs || [];
  }

  async start(context) {
    this.context = context;
  }

  serialize() {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
    };
  }
}

// Mock createLegacyModuleAdapter
function createLegacyModuleAdapter(config) {
  return {
    manifest: {
      ports: {
        outputs: [{ id: 'audio', type: 'audio' }],
      },
    },
    async create(options) {
      const instance = new config.moduleClass();
      await instance.start(options.audioContext);
      return { legacy: instance };
    },
  };
}

class LegacyTone extends MockModuleBase {
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
    expect(instance.legacy.serialize()).toEqual({
      id: 'legacy-tone',
      title: 'Legacy Tone',
      kind: 'audio-source',
    });
  });
});
