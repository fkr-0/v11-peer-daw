export function createModuleManifest(definition) {
  return {
    capabilities: {},
    dsp: {},
    ports: { inputs: [], outputs: [] },
    ...definition,
  };
}

export function validateModuleManifest(manifest) {
  const errors = [];

  if (manifest.capabilities?.worklet && !manifest.dsp?.worklet) {
    errors.push('capabilities.worklet requires dsp.worklet');
  }

  if (manifest.capabilities?.wasm && !manifest.dsp?.wasm) {
    errors.push('capabilities.wasm requires dsp.wasm');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
