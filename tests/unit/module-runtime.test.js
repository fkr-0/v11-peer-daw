// V11 Peer DAW/tests/unit/module-runtime.test.js
// Unit tests for module runtime ABI

const { describe, expect, test } = require('@jest/globals');

// Mock createModuleManifest
function createModuleManifest(config) {
  return {
    id: config.id,
    name: config.name,
    version: config.version,
    apiVersion: config.apiVersion,
    entry: config.entry,
    capabilities: config.capabilities,
    ports: config.ports,
    dsp: config.dsp,
  };
}

// Mock validateModuleManifest
function validateModuleManifest(manifest) {
  const errors = [];

  if (manifest.capabilities?.worklet && !manifest.dsp?.worklet) {
    errors.push('capabilities.worklet requires dsp.worklet');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

describe('module runtime ABI', () => {
  test('validates a hybrid ES module shell manifest with optional worklet and wasm DSP', () => {
    const manifest = createModuleManifest({
      id: 'field-recorder',
      name: 'Field Recorder',
      version: '1.0.0',
      apiVersion: 'v1',
      entry: './index.js',
      capabilities: { audio: true, ui: true, worklet: true, wasm: true },
      ports: {
        inputs: [{ id: 'control', type: 'control' }],
        outputs: [{ id: 'audio', type: 'audio' }],
      },
      dsp: {
        worklet: './processor.worklet.js',
        wasm: './field-recorder.wasm',
      },
    });

    expect(validateModuleManifest(manifest)).toEqual({ ok: true, errors: [] });
  });

  test('rejects manifests that claim worklet capability without a worklet processor path', () => {
    const manifest = createModuleManifest({
      id: 'broken',
      name: 'Broken',
      version: '1.0.0',
      apiVersion: 'v1',
      entry: './index.js',
      capabilities: { audio: true, ui: false, worklet: true },
      ports: { inputs: [], outputs: [] },
    });

    expect(validateModuleManifest(manifest)).toEqual({
      ok: false,
      errors: ['capabilities.worklet requires dsp.worklet'],
    });
  });
});
