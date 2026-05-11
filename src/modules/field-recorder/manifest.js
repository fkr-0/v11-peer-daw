import { createModuleManifest } from '../../core/module-runtime.js';

export const manifest = createModuleManifest({
  id: 'field-recorder',
  name: 'Field Recorder',
  version: '1.0.0',
  apiVersion: 'v1',
  entry: './index.js',
  capabilities: {
    audio: true,
    ui: true,
    worklet: true,
    wasm: false,
  },
  ports: {
    inputs: [{ id: 'control', type: 'control' }],
    outputs: [{ id: 'audio', type: 'audio' }],
  },
  dsp: {
    worklet: './processor.worklet.js',
  },
});
