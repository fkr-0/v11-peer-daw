import {
  CAPABILITIES_MESSAGE_TYPE,
  COLLABORATION_CAPABILITY,
  COLLABORATION_PROTOCOL,
  OPERATION_ACK_TYPE,
  OPERATION_MESSAGE_TYPE,
  OperationClock,
  createCapabilitiesMessage,
  createOperationAck,
  createOperationMessage,
  summarizeOperation,
  validateOperation,
} from './project-operations.js';
import { OperationJournal } from './operation-journal.js';

const RETRY_DELAYS = [800, 1600, 3200, 6400];

export class CollaborationEngine {
  constructor({
    actorId,
    sessionCode,
    storage,
    send = () => [],
    applyOperation = () => ({ status: 'applied' }),
    requestSnapshot = () => {},
    getRevision = () => 0,
    onChange = () => {},
    now = () => Date.now(),
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  } = {}) {
    this.actorId = String(actorId || 'actor');
    this.sessionCode = String(sessionCode || 'V11-OPEN-STUDIO');
    this.send = send;
    this.applyOperation = applyOperation;
    this.requestSnapshot = requestSnapshot;
    this.getRevision = getRevision;
    this.onChange = onChange;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.clock = new OperationClock({ actorId: this.actorId });
    this.journal = new OperationJournal({ roomId: this.sessionCode, actorId: this.actorId, storage, now });
    this.peerCapabilities = new Map();
    this.retryTimer = null;
    this.lastRemoteOperationAt = 0;
    this.lastRecoveredAt = 0;
  }

  start() {
    this.broadcastCapabilities();
    if (!this.retryTimer && this.setIntervalFn) this.retryTimer = this.setIntervalFn(() => this.retryDue(), 400);
    this.emitChange();
  }

  stop() {
    if (this.retryTimer && this.clearIntervalFn) this.clearIntervalFn(this.retryTimer);
    this.retryTimer = null;
  }

  setSessionCode(sessionCode) {
    this.sessionCode = String(sessionCode || this.sessionCode);
    this.peerCapabilities.clear();
    this.journal.setRoom(this.sessionCode);
    this.broadcastCapabilities();
    this.emitChange();
  }

  publish(domain, action, target = {}, payload = {}, options = {}) {
    const operation = this.clock.create(domain, action, target, payload, {
      baseRevision: this.getRevision(),
      batchId: options.batchId,
    });
    const validation = validateOperation(operation);
    if (!validation.valid) throw new Error(`Invalid collaboration operation: ${validation.errors.join(', ')}`);
    const peers = this.compatiblePeerIds();
    const message = createOperationMessage({
      clientId: this.actorId,
      sessionCode: this.sessionCode,
      operation,
      at: this.now(),
    });
    this.journal.enqueue(operation, {
      peers,
      messageId: message.messageId,
      summary: options.summary || summarizeOperation(operation, { actorLabel: 'You' }),
    });
    this.sendOperation(message, operation);
    this.emitChange();
    return operation;
  }

  sendOperation(message, operation) {
    const deliveries = normalizeDeliveries(this.send(message, { transport: 'all' }));
    const delivered = deliveries.some((delivery) => delivery.delivered);
    const peerCount = Math.max(0, ...deliveries.map((delivery) => Number(delivery.peerCount || 0)));
    const entry = this.journal.entries.get(operation.opId);
    const delay = RETRY_DELAYS[Math.min(entry?.attempts || 0, RETRY_DELAYS.length - 1)];
    this.journal.markSent(operation.opId, { delivered, peerCount, retryDelay: delay });
    return deliveries;
  }

  receive(message = {}, meta = {}) {
    if (!message || message.protocol !== COLLABORATION_PROTOCOL) return false;
    if (message.sessionCode !== this.sessionCode || message.clientId === this.actorId) return false;
    if (message.type === CAPABILITIES_MESSAGE_TYPE) {
      this.peerCapabilities.set(message.clientId, {
        capabilities: new Set(message.capabilities || []),
        at: Number(message.at || this.now()),
        peerId: meta.peerId || '',
      });
      this.journal.setExpectedPeers(this.compatiblePeerIds());
      this.emitChange();
      return true;
    }
    if (message.type === OPERATION_ACK_TYPE) {
      if (!message.ackFor) return false;
      this.clock.observe({ lamport: message.lamport || 0 });
      this.journal.acknowledge(message.ackFor, message.clientId, {
        result: message.result,
        reason: message.reason,
        at: message.at,
      });
      if (message.result === 'needs-snapshot') this.requestSnapshot({ reason: message.reason || 'peer-needs-snapshot' });
      this.emitChange();
      return true;
    }
    if (message.type !== OPERATION_MESSAGE_TYPE) return false;
    const operation = message.operation;
    const validation = validateOperation(operation);
    if (!validation.valid) {
      this.sendAck(message, meta, 'rejected', validation.errors.join(','));
      return true;
    }
    this.clock.observe(operation);
    if (this.journal.hasApplied(operation.opId)) {
      this.sendAck(message, meta, 'duplicate');
      return true;
    }
    const result = this.applyOperation(operation, { message, meta }) || { status: 'rejected', reason: 'empty-result' };
    if (result.status === 'applied' || result.status === 'duplicate') {
      this.journal.markApplied(operation, {
        actorLabel: message.username || message.clientId,
        at: message.at,
      });
      this.lastRemoteOperationAt = this.now();
    } else if (result.status === 'rejected' || result.status === 'needs-snapshot') {
      this.journal.addConflict({
        opId: operation.opId,
        operation,
        result: result.status,
        reason: result.reason || '',
        summary: summarizeOperation(operation, { actorLabel: message.clientId }),
        localValue: result.localValue,
        remoteValue: result.remoteValue,
      });
    }
    this.sendAck(message, meta, result.status, result.reason || '');
    if (result.status === 'needs-snapshot') this.requestSnapshot({ reason: result.reason || 'operation-gap' });
    this.emitChange();
    return true;
  }

  sendAck(message, meta, result, reason = '') {
    const ack = createOperationAck({
      clientId: this.actorId,
      sessionCode: this.sessionCode,
      ackFor: message.operation?.opId || message.messageId,
      opId: message.operation?.opId || '',
      result,
      revision: this.getRevision(),
      lamport: this.clock.lamport,
      reason,
      at: this.now(),
    });
    this.send(ack, { transport: meta.transport || 'all', peerId: meta.peerId || '' });
  }

  retryDue() {
    const due = this.journal.dueOperations(this.now());
    for (const entry of due) {
      if (entry.attempts >= RETRY_DELAYS.length + 1) continue;
      const message = createOperationMessage({
        clientId: this.actorId,
        sessionCode: this.sessionCode,
        operation: entry.operation,
        messageId: entry.messageId,
        at: this.now(),
      });
      this.sendOperation(message, entry.operation);
    }
    if (due.length) this.emitChange();
    return due.length;
  }

  replayPending() {
    let count = 0;
    for (const entry of this.journal.pendingOperations()) {
      if (entry.status === 'rejected' || entry.status === 'discarded') continue;
      const message = createOperationMessage({
        clientId: this.actorId,
        sessionCode: this.sessionCode,
        operation: entry.operation,
        messageId: entry.messageId,
        at: this.now(),
      });
      this.sendOperation(message, entry.operation);
      count += 1;
    }
    this.emitChange();
    return count;
  }

  checkpoint({ revision = this.getRevision(), vector = {} } = {}) {
    this.journal.setCheckpoint({ revision, vector, at: this.now() });
    this.lastRecoveredAt = this.now();
    this.emitChange();
  }

  broadcastCapabilities() {
    const message = createCapabilitiesMessage({ clientId: this.actorId, sessionCode: this.sessionCode, at: this.now() });
    this.send(message, { transport: 'all' });
    return message;
  }

  compatiblePeerIds() {
    return [...this.peerCapabilities.entries()]
      .filter(([, peer]) => peer.capabilities.has(COLLABORATION_CAPABILITY))
      .map(([clientId]) => clientId);
  }

  mixedCompatibility() {
    return [...this.peerCapabilities.values()].some((peer) => !peer.capabilities.has(COLLABORATION_CAPABILITY));
  }

  resolveConflict(conflictId, resolution) {
    const conflict = this.journal.resolveConflict(conflictId, resolution);
    if (!conflict) return null;
    if (resolution === 'recover-snapshot') this.requestSnapshot({ reason: 'manual-conflict-recovery' });
    this.emitChange();
    return conflict;
  }

  diagnostics() {
    const journal = this.journal.diagnostics();
    const state = journal.conflictCount
      ? 'conflict'
      : journal.pendingCount
        ? journal.counts.retrying
          ? 'retrying'
          : 'pending'
        : this.lastRecoveredAt
          ? 'recovered'
          : 'synced';
    return {
      ...journal,
      state,
      protocol: COLLABORATION_PROTOCOL,
      capability: COLLABORATION_CAPABILITY,
      sequence: this.clock.sequence,
      lamport: this.clock.lamport,
      compatiblePeers: this.compatiblePeerIds(),
      mixedCompatibility: this.mixedCompatibility(),
      lastRemoteOperationAt: this.lastRemoteOperationAt,
      lastRecoveredAt: this.lastRecoveredAt,
      activities: [...this.journal.activities].reverse(),
      conflicts: [...this.journal.conflicts].filter((item) => item.status !== 'resolved').reverse(),
      entries: [...this.journal.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }

  emitChange() {
    this.onChange(this.diagnostics());
  }
}

function normalizeDeliveries(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
