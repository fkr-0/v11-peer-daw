// V11 Peer DAW/src/core/module-selectors.js
// Pure module classification helpers used by workspace/mixer/editor selection.

import { PortType } from './contracts.js';

export function workspaceModules(modules = []) {
  if (modules instanceof Map) return [...modules.values()];
  if (Array.isArray(modules)) return [...modules];
  if (modules?.values) return [...modules.values()];
  return [];
}

export function clipCapableModules(modules = []) {
  return workspaceModules(modules).filter(
    (module) =>
      module.inputs?.some((p) => p.type === PortType.CLOCK || p.type === PortType.MIDI) ||
      module.outputs?.some((p) => p.type === PortType.MIDI || p.type === PortType.CONTROL) ||
      ['sequencer', 'ocra', 'pianoroll'].includes(module.kind)
  );
}

export function mixerModules(modules = [], { mixer = null } = {}) {
  return workspaceModules(modules).filter(
    (module) =>
      module.outputs?.some((p) => p.type === PortType.AUDIO) ||
      module.inputs?.some((p) => p.type === PortType.AUDIO) ||
      module === mixer
  );
}

export function isSamplerModule(module) {
  return Boolean(
    module &&
      (module.kind === 'audio-source' ||
        module.fileName ||
        module.sampleMetadata ||
        module.pads ||
        module.zones) &&
      (module.setSampleMetadata || module.assignPad || module.sliceCount !== undefined)
  );
}

export function isPatternModule(module) {
  return Boolean(
    module &&
      (Array.isArray(module.rows) ||
        Array.isArray(module.grid) ||
        typeof module.arpPattern === 'function')
  );
}
