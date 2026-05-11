import { createModuleManifest } from './module-runtime.js';

export function createLegacyModuleAdapter({ id, name, version, moduleClass }) {
  const probe = new moduleClass();

  return {
    manifest: createModuleManifest({
      id,
      name,
      version,
      apiVersion: 'v1',
      capabilities: {
        audio: true,
        ui: true,
      },
      ports: {
        inputs: probe.inputs ?? [],
        outputs: probe.outputs ?? [],
      },
    }),

    async create({ audioContext } = {}) {
      const legacy = new moduleClass();
      await legacy.start(audioContext);

      return {
        legacy,
        serialize() {
          return legacy.serialize();
        },
        dispose() {
          legacy.stop?.();
        },
      };
    },
  };
}
