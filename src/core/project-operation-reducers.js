import {
  OPERATION_DOMAINS,
  compareOperationClock,
  operationFieldKey,
  structuredCloneSafe,
  validateOperation,
} from './project-operations.js';

function findModule(project, moduleId) {
  return project?.modules?.find?.((module) => module.id === moduleId) || null;
}

function setPath(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return false;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = structuredCloneSafe(value);
  return true;
}

function scalarAllowed(operation, fieldVersions) {
  const key = operationFieldKey(operation);
  const previous = fieldVersions.get(key);
  if (previous && compareOperationClock(operation, previous) <= 0) {
    return { allowed: false, key, previous };
  }
  fieldVersions.set(key, { lamport: operation.lamport, actorId: operation.actorId, opId: operation.opId });
  return { allowed: true, key, previous };
}

function ensureProjectShape(project) {
  project.modules ||= [];
  project.mixer ||= { masterVolume: 0.8, channels: {} };
  project.mixer.channels ||= {};
  project.clips ||= { currentBeat: 0, slots: [] };
  project.clips.slots ||= [];
  project.arrangement ||= { loopStartBeat: 0, loopEndBeat: 16, clips: [] };
  project.arrangement.clips ||= [];
  return project;
}

function applySingle(project, operation, context) {
  const changedPaths = [];
  const target = operation.target || {};
  const payload = operation.payload || {};
  const scalar = () => scalarAllowed(operation, context.fieldVersions);

  if (operation.domain === OPERATION_DOMAINS.MODULE_PARAMETER) {
    const module = findModule(project, target.moduleId);
    if (!module || !target.parameter) return reject('module-or-parameter-missing');
    if (!scalar().allowed) return duplicate('stale-field-clock');
    const path = String(target.parameter);
    if (module.params && Object.hasOwn(module.params, path)) module.params[path] = structuredCloneSafe(payload.value);
    else setPath(module, path, payload.value);
    changedPaths.push(`modules.${target.moduleId}.${path}`);
  } else if (operation.domain === OPERATION_DOMAINS.MIXER_MASTER) {
    if (!scalar().allowed) return duplicate('stale-field-clock');
    const field = target.field || 'masterVolume';
    project.mixer[field] = structuredCloneSafe(payload.value);
    changedPaths.push(`mixer.${field}`);
  } else if (operation.domain === OPERATION_DOMAINS.MIXER_CHANNEL) {
    if (operation.action === 'unsolo-all') {
      for (const channel of Object.values(project.mixer.channels)) channel.solo = false;
      changedPaths.push('mixer.channels.*.solo');
    } else {
      const channelId = target.channelId || target.moduleId;
      if (!channelId || !target.field) return reject('channel-or-field-missing');
      if (!scalar().allowed) return duplicate('stale-field-clock');
      project.mixer.channels[channelId] ||= { gain: 0.8, pan: 0, muted: false, solo: false };
      project.mixer.channels[channelId][target.field] = structuredCloneSafe(payload.value);
      changedPaths.push(`mixer.channels.${channelId}.${target.field}`);
    }
  } else if (operation.domain === OPERATION_DOMAINS.CLOCK) {
    const module = findModule(project, target.moduleId);
    if (!module) return reject('clock-module-missing');
    if (!scalar().allowed) return duplicate('stale-field-clock');
    module.bpm = Number(payload.value);
    changedPaths.push(`modules.${target.moduleId}.bpm`);
  } else if (operation.domain === OPERATION_DOMAINS.CLIP_SLOT) {
    const slots = project.clips.slots;
    const index = slots.findIndex((slot) => slot.id === target.slotId);
    if (operation.action === 'add') {
      if (index >= 0) return duplicate('slot-exists');
      slots.push(structuredCloneSafe(payload.slot));
      changedPaths.push(`clips.slots.${target.slotId}`);
    } else if (operation.action === 'delete') {
      if (index < 0) return duplicate('slot-absent');
      slots.splice(index, 1);
      changedPaths.push(`clips.slots.${target.slotId}`);
    } else {
      if (index < 0) return needsSnapshot('slot-missing');
      if (!scalar().allowed) return duplicate('stale-field-clock');
      if (operation.action === 'launch') {
        slots[index].launchBeat = Number(payload.beat);
        slots[index].stopBeat = null;
      } else if (operation.action === 'stop') slots[index].stopBeat = Number(payload.beat);
      else if (target.field) slots[index][target.field] = structuredCloneSafe(payload.value);
      changedPaths.push(`clips.slots.${target.slotId}.${target.field || operation.action}`);
    }
  } else if (operation.domain === OPERATION_DOMAINS.NOTE) {
    const module = findModule(project, target.moduleId);
    if (!module) return reject('note-module-missing');
    module.notes ||= [];
    const index = module.notes.findIndex((note) => note.id === target.noteId);
    if (operation.action === 'add') {
      if (index >= 0) return duplicate('note-exists');
      module.notes.push(structuredCloneSafe(payload.note));
      module.notes.sort((a, b) => Number(a.beat || 0) - Number(b.beat || 0) || String(a.note || '').localeCompare(String(b.note || '')));
    } else if (operation.action === 'delete') {
      context.tombstones.set(`note:${target.moduleId}:${target.noteId}`, operationClock(operation));
      if (index < 0) return duplicate('note-absent');
      module.notes.splice(index, 1);
    } else if (operation.action === 'clear') {
      module.notes = [];
    } else {
      if (index < 0) return needsSnapshot('note-missing');
      if (!scalar().allowed) return duplicate('stale-field-clock');
      Object.assign(module.notes[index], structuredCloneSafe(payload.patch || {}));
    }
    changedPaths.push(`modules.${target.moduleId}.notes.${target.noteId || '*'}`);
  } else if (operation.domain === OPERATION_DOMAINS.SEQUENCER_STEP) {
    const module = findModule(project, target.moduleId);
    if (!module) return reject('sequencer-module-missing');
    module.steps ||= [];
    const index = module.steps.findIndex((step) => step.id === target.stepId);
    if (operation.action === 'clear') {
      if (index < 0) return duplicate('step-absent');
      module.steps.splice(index, 1);
    } else if (index >= 0) Object.assign(module.steps[index], structuredCloneSafe(payload.patch || {}));
    else module.steps.push(structuredCloneSafe(payload.step));
    changedPaths.push(`modules.${target.moduleId}.steps.${target.stepId}`);
  } else if (operation.domain === OPERATION_DOMAINS.ARRANGEMENT_PLACEMENT) {
    const placements = project.arrangement.clips;
    const index = placements.findIndex((placement) => placement.placementId === target.placementId);
    if (operation.action === 'add') {
      if (index >= 0) return duplicate('placement-exists');
      placements.push(structuredCloneSafe(payload.placement));
    } else if (operation.action === 'delete') {
      context.tombstones.set(`placement:${target.placementId}`, operationClock(operation));
      if (index < 0) return duplicate('placement-absent');
      placements.splice(index, 1);
    } else {
      if (index < 0) return needsSnapshot('placement-missing');
      if (!scalar().allowed) return duplicate('stale-field-clock');
      Object.assign(placements[index], structuredCloneSafe(payload.patch || {}));
    }
    changedPaths.push(`arrangement.clips.${target.placementId}`);
  } else if (operation.domain === OPERATION_DOMAINS.ARRANGEMENT_LOOP) {
    if (!scalar().allowed) return duplicate('stale-field-clock');
    project.arrangement.loopStartBeat = Number(payload.startBeat);
    project.arrangement.loopEndBeat = Number(payload.endBeat);
    changedPaths.push('arrangement.loop');
  } else if (operation.domain === OPERATION_DOMAINS.MULTISAMPLER_ZONE) {
    const module = findModule(project, target.moduleId);
    if (!module) return reject('multisampler-module-missing');
    module.zones ||= [];
    const index = module.zones.findIndex((zone) => zone.id === target.zoneId);
    if (operation.action === 'add') {
      if (index >= 0) return duplicate('zone-exists');
      module.zones.push(structuredCloneSafe(payload.zone));
    } else if (operation.action === 'delete') {
      if (index < 0) return duplicate('zone-absent');
      module.zones.splice(index, 1);
    } else {
      if (index < 0) return needsSnapshot('zone-missing');
      if (!scalar().allowed) return duplicate('stale-field-clock');
      Object.assign(module.zones[index], structuredCloneSafe(payload.patch || {}));
    }
    changedPaths.push(`modules.${target.moduleId}.zones.${target.zoneId}`);
  } else return reject('unsupported-domain');

  return { status: 'applied', changedPaths };
}

export function applyProjectOperation(projectInput = {}, operation = {}, context = {}) {
  const validation = validateOperation(operation);
  if (!validation.valid) return { status: 'rejected', reason: validation.errors.join(','), project: projectInput, changedPaths: [] };
  const project = ensureProjectShape(structuredCloneSafe(projectInput));
  const reducerContext = {
    fieldVersions: context.fieldVersions || new Map(),
    tombstones: context.tombstones || new Map(),
  };

  if (operation.domain === OPERATION_DOMAINS.BATCH) {
    const changedPaths = [];
    let current = project;
    const nested = operation.payload.operations;
    for (const [index, raw] of nested.entries()) {
      const nestedOperation = {
        ...raw,
        opId: raw.opId || `${operation.opId}.${index + 1}`,
        actorId: raw.actorId || operation.actorId,
        sequence: raw.sequence || operation.sequence,
        lamport: raw.lamport || operation.lamport,
        baseRevision: raw.baseRevision ?? operation.baseRevision,
      };
      const result = applyProjectOperation(current, nestedOperation, reducerContext);
      if (!['applied', 'duplicate'].includes(result.status)) {
        return { ...result, project: projectInput, changedPaths: [] };
      }
      current = result.project;
      changedPaths.push(...result.changedPaths);
    }
    return { status: 'applied', project: current, changedPaths, context: reducerContext };
  }

  const result = applySingle(project, operation, reducerContext);
  return { ...result, project: result.status === 'applied' ? project : projectInput, context: reducerContext };
}

function operationClock(operation) {
  return { lamport: operation.lamport, actorId: operation.actorId, opId: operation.opId };
}

function reject(reason) {
  return { status: 'rejected', reason, changedPaths: [] };
}

function needsSnapshot(reason) {
  return { status: 'needs-snapshot', reason, changedPaths: [] };
}

function duplicate(reason) {
  return { status: 'duplicate', reason, changedPaths: [] };
}
