export const COLLABORATION_PROTOCOL = 2;
export const COLLABORATION_CAPABILITY = 'project-ops-v1';
export const OPERATION_MESSAGE_TYPE = 'project-operation';
export const OPERATION_ACK_TYPE = 'operation-ack';
export const CAPABILITIES_MESSAGE_TYPE = 'collaboration-capabilities';

export const OPERATION_DOMAINS = Object.freeze({
  MODULE_PARAMETER: 'module-parameter',
  MIXER_MASTER: 'mixer-master',
  MIXER_CHANNEL: 'mixer-channel',
  CLOCK: 'clock',
  CLIP_SLOT: 'clip-slot',
  NOTE: 'note',
  SEQUENCER_STEP: 'sequencer-step',
  ARRANGEMENT_PLACEMENT: 'arrangement-placement',
  ARRANGEMENT_LOOP: 'arrangement-loop',
  MULTISAMPLER_ZONE: 'multisampler-zone',
  BATCH: 'batch',
});

const DOMAIN_ACTIONS = Object.freeze({
  [OPERATION_DOMAINS.MODULE_PARAMETER]: new Set(['set']),
  [OPERATION_DOMAINS.MIXER_MASTER]: new Set(['set']),
  [OPERATION_DOMAINS.MIXER_CHANNEL]: new Set(['set', 'unsolo-all']),
  [OPERATION_DOMAINS.CLOCK]: new Set(['set-bpm']),
  [OPERATION_DOMAINS.CLIP_SLOT]: new Set(['set', 'launch', 'stop', 'add', 'delete']),
  [OPERATION_DOMAINS.NOTE]: new Set(['add', 'update', 'delete', 'clear']),
  [OPERATION_DOMAINS.SEQUENCER_STEP]: new Set(['set', 'clear']),
  [OPERATION_DOMAINS.ARRANGEMENT_PLACEMENT]: new Set(['add', 'update', 'delete']),
  [OPERATION_DOMAINS.ARRANGEMENT_LOOP]: new Set(['set']),
  [OPERATION_DOMAINS.MULTISAMPLER_ZONE]: new Set(['add', 'update', 'delete']),
  [OPERATION_DOMAINS.BATCH]: new Set(['apply']),
});

const MAX_OPERATION_BYTES = 64 * 1024;

function safeJsonSize(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function compareOperationClock(a = {}, b = {}) {
  const lamportDelta = Number(a.lamport || 0) - Number(b.lamport || 0);
  if (lamportDelta) return lamportDelta;
  return String(a.actorId || '').localeCompare(String(b.actorId || ''));
}

export function operationTargetKey(operation = {}) {
  const target = operation.target || {};
  const targetParts = Object.entries(target)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
  return `${operation.domain || 'unknown'}:${operation.action || 'unknown'}:${targetParts}`;
}

export function operationFieldKey(operation = {}) {
  const target = operation.target || {};
  const field = target.parameter || target.field || target.property || operation.payload?.field || '';
  const identity =
    target.moduleId ||
    target.channelId ||
    target.slotId ||
    target.noteId ||
    target.placementId ||
    target.zoneId ||
    target.rowId ||
    'project';
  return `${operation.domain || 'unknown'}:${identity}:${field || operation.action || 'value'}`;
}

export function validateOperation(operation, { maxBytes = MAX_OPERATION_BYTES } = {}) {
  const errors = [];
  if (!operation || typeof operation !== 'object') return { valid: false, errors: ['operation'] };
  if (!nonEmptyString(operation.opId)) errors.push('opId');
  if (!nonEmptyString(operation.actorId)) errors.push('actorId');
  if (!Number.isInteger(Number(operation.sequence)) || Number(operation.sequence) < 1)
    errors.push('sequence');
  if (!Number.isFinite(Number(operation.lamport)) || Number(operation.lamport) < 1)
    errors.push('lamport');
  if (!Number.isFinite(Number(operation.baseRevision)) || Number(operation.baseRevision) < 0)
    errors.push('baseRevision');
  if (!DOMAIN_ACTIONS[operation.domain]) errors.push('domain');
  else if (!DOMAIN_ACTIONS[operation.domain].has(operation.action)) errors.push('action');
  if (!operation.target || typeof operation.target !== 'object') errors.push('target');
  if (safeJsonSize(operation) > maxBytes) errors.push('payload-too-large');
  if (operation.domain === OPERATION_DOMAINS.BATCH) {
    const nested = operation.payload?.operations;
    if (!Array.isArray(nested) || nested.length < 1 || nested.length > 256) errors.push('batch');
  }
  return { valid: errors.length === 0, errors };
}

export class OperationClock {
  constructor({ actorId = 'actor', sequence = 0, lamport = 0 } = {}) {
    this.actorId = String(actorId || 'actor');
    this.sequence = Math.max(0, Number(sequence || 0));
    this.lamport = Math.max(0, Number(lamport || 0));
  }

  observe(operation = {}) {
    this.lamport = Math.max(this.lamport, Number(operation.lamport || 0));
    return this.lamport;
  }

  create(domain, action, target = {}, payload = {}, { baseRevision = 0, batchId = '' } = {}) {
    this.sequence += 1;
    this.lamport += 1;
    const operation = {
      opId: `${this.actorId}:${this.sequence}`,
      actorId: this.actorId,
      sequence: this.sequence,
      lamport: this.lamport,
      baseRevision: Math.max(0, Number(baseRevision || 0)),
      domain,
      action,
      target: { ...target },
      payload: structuredCloneSafe(payload),
    };
    if (batchId) operation.batchId = String(batchId);
    return operation;
  }

  snapshot() {
    return { actorId: this.actorId, sequence: this.sequence, lamport: this.lamport };
  }
}

export function createOperationMessage({ clientId, sessionCode, operation, messageId = '', at = Date.now() }) {
  return {
    protocol: COLLABORATION_PROTOCOL,
    type: OPERATION_MESSAGE_TYPE,
    messageId: messageId || `${clientId}:${Number(at).toString(36)}:${operation?.sequence || 0}`,
    clientId: String(clientId || operation?.actorId || 'client'),
    sessionCode: String(sessionCode || 'V11-OPEN-STUDIO'),
    at: Number(at),
    operation,
  };
}

export function createOperationAck({
  clientId,
  sessionCode,
  ackFor,
  opId,
  result = 'applied',
  revision = 0,
  lamport = 0,
  reason = '',
  at = Date.now(),
}) {
  return {
    protocol: COLLABORATION_PROTOCOL,
    type: OPERATION_ACK_TYPE,
    messageId: `${clientId}:ack:${Number(at).toString(36)}:${opId || ackFor}`,
    clientId: String(clientId || 'client'),
    sessionCode: String(sessionCode || 'V11-OPEN-STUDIO'),
    at: Number(at),
    ackFor: String(ackFor || opId || ''),
    opId: String(opId || ''),
    result,
    revision: Math.max(0, Number(revision || 0)),
    lamport: Math.max(0, Number(lamport || 0)),
    reason: String(reason || ''),
  };
}

export function createCapabilitiesMessage({ clientId, sessionCode, capabilities = [COLLABORATION_CAPABILITY], at = Date.now() }) {
  return {
    protocol: COLLABORATION_PROTOCOL,
    type: CAPABILITIES_MESSAGE_TYPE,
    messageId: `${clientId}:caps:${Number(at).toString(36)}`,
    clientId: String(clientId || 'client'),
    sessionCode: String(sessionCode || 'V11-OPEN-STUDIO'),
    at: Number(at),
    capabilities: [...new Set(capabilities.map(String))],
  };
}

export function summarizeOperation(operation = {}, { actorLabel = '' } = {}) {
  const who = actorLabel || operation.actorId || 'peer';
  const target = operation.target || {};
  const value = operation.payload?.value;
  switch (operation.domain) {
    case OPERATION_DOMAINS.MODULE_PARAMETER:
      return `${who} changed ${target.moduleTitle || target.moduleId || 'module'} ${target.parameter || 'parameter'}${value !== undefined ? ` to ${formatValue(value)}` : ''}`;
    case OPERATION_DOMAINS.MIXER_MASTER:
      return `${who} changed master ${target.field || 'level'}${value !== undefined ? ` to ${formatValue(value)}` : ''}`;
    case OPERATION_DOMAINS.MIXER_CHANNEL:
      return operation.action === 'unsolo-all'
        ? `${who} cleared all channel solos`
        : `${who} changed ${target.channelTitle || target.channelId || 'channel'} ${target.field || 'setting'}${value !== undefined ? ` to ${formatValue(value)}` : ''}`;
    case OPERATION_DOMAINS.CLOCK:
      return `${who} set tempo to ${formatValue(value)} BPM`;
    case OPERATION_DOMAINS.CLIP_SLOT:
      return `${who} ${operation.action === 'set' ? 'changed' : operation.action === 'delete' ? 'removed' : `${operation.action}ed`} ${target.slotTitle || target.slotId || 'clip'}`;
    case OPERATION_DOMAINS.NOTE:
      return `${who} ${operation.action === 'delete' ? 'removed' : operation.action === 'clear' ? 'cleared' : operation.action === 'add' ? 'added' : 'changed'} ${target.noteName || target.noteId || 'note'}`;
    case OPERATION_DOMAINS.SEQUENCER_STEP:
      return `${who} ${operation.action === 'clear' ? 'cleared' : 'changed'} a sequencer step`;
    case OPERATION_DOMAINS.ARRANGEMENT_PLACEMENT:
      return `${who} ${operation.action === 'delete' ? 'removed' : operation.action === 'add' ? 'placed' : 'moved'} ${target.clipTitle || target.placementId || 'arrangement clip'}`;
    case OPERATION_DOMAINS.ARRANGEMENT_LOOP:
      return `${who} changed the arrangement loop`;
    case OPERATION_DOMAINS.MULTISAMPLER_ZONE:
      return `${who} ${operation.action === 'delete' ? 'removed' : operation.action === 'add' ? 'added' : 'changed'} a multisampler zone`;
    case OPERATION_DOMAINS.BATCH:
      return `${who} applied ${operation.payload?.operations?.length || 0} edits`;
    default:
      return `${who} changed the project`;
  }
}

export function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_) {}
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function formatValue(value) {
  if (typeof value === 'number') return Number(value.toFixed(3)).toString();
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}
