// V11 Peer DAW/src/core/project-state.js
// Pure project/rig serialization helpers used by app orchestration and tests.

export function serializeMixerState(mixerState = {}) {
  return {
    masterVolume: mixerState.masterVolume,
    channels: Object.fromEntries(
      Object.entries(mixerState.channels || {}).map(([id, channel]) => [id, { ...channel }])
    ),
  };
}

export function serializeClipState({ currentBeat = 0, clipSlots = [] } = {}) {
  return {
    currentBeat,
    slots: clipSlots.map((slot) => ({
      id: slot.id,
      moduleId: slot.moduleId,
      name: slot.name,
      channelId: slot.channelId,
      quantizationBeats: slot.quantizationBeats,
      launchBeat: slot.launchBeat,
      stopBeat: slot.stopBeat,
      clip: slot.clip?.serialize?.() || null,
    })),
  };
}

function serializedModules(modules = []) {
  return modules.map(
    (module) =>
      module.serialize?.() || {
        id: module.id,
        kind: module.kind,
        title: module.title,
      }
  );
}

function sharedProjectState({
  routes = [],
  clipState,
  arrangement,
  mixerState,
  routingGraph,
  patchCanvas,
} = {}) {
  return {
    routes,
    clips: clipState || { currentBeat: 0, slots: [] },
    arrangement: arrangement?.serialize?.() ||
      arrangement || { loopStartBeat: 0, loopEndBeat: 0, clips: [] },
    mixer: serializeMixerState(mixerState),
    graph: routingGraph?.serialize?.() || { nodes: [], edges: [], chains: [] },
    canvasPositions: patchCanvas?.serializePositions?.() || {},
  };
}

export function createProjectSource({ modules = [], ...state } = {}) {
  return {
    modules,
    ...sharedProjectState(state),
  };
}

export function serializeRig({ modules = [], ...state } = {}) {
  return {
    version: 1,
    modules: serializedModules(modules),
    ...sharedProjectState(state),
  };
}
