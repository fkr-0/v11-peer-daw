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

export function normalizeProjectStableIds(projectInput = {}) {
  const project = typeof structuredClone === 'function'
    ? structuredClone(projectInput)
    : JSON.parse(JSON.stringify(projectInput));
  project.clips ||= { currentBeat: 0, slots: [] };
  project.clips.slots = Array.from(project.clips.slots || []).map((slot, index) => ({
    ...slot,
    id: slot.id || `legacy-slot-${index + 1}`,
  }));
  project.arrangement ||= { loopStartBeat: 0, loopEndBeat: 16, clips: [] };
  project.arrangement.clips = Array.from(project.arrangement.clips || []).map((placement, index) => ({
    ...placement,
    placementId:
      placement.placementId ||
      `legacy-placement-${index + 1}-${String(placement.clip?.id || 'clip').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(placement.trackId || 'track').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(Number(placement.startBeat || 0)).replace('.', '_')}`,
  }));
  project.modules = Array.from(project.modules || []).map((module) => ({
    ...module,
    notes: Array.isArray(module.notes)
      ? module.notes.map((note, index) => ({ ...note, id: note.id || `${module.id || 'module'}-note-${index + 1}` }))
      : module.notes,
    zones: Array.isArray(module.zones)
      ? module.zones.map((zone, index) => ({ ...zone, id: zone.id || `${module.id || 'module'}-zone-${index + 1}` }))
      : module.zones,
  }));
  return project;
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
