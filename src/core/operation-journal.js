import { structuredCloneSafe, summarizeOperation } from './project-operations.js';

export class MemoryJournalStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

export class OperationJournal {
  constructor({
    roomId = 'V11-OPEN-STUDIO',
    actorId = 'actor',
    storage = globalThis.localStorage,
    storagePrefix = 'v11-daw-operation-journal',
    now = () => Date.now(),
    maxEntries = 1000,
    maxBytes = 2 * 1024 * 1024,
  } = {}) {
    this.roomId = String(roomId);
    this.actorId = String(actorId);
    this.storage = storage;
    this.storagePrefix = storagePrefix;
    this.now = now;
    this.maxEntries = Math.max(50, Number(maxEntries || 1000));
    this.maxBytes = Math.max(64 * 1024, Number(maxBytes || 2 * 1024 * 1024));
    this.entries = new Map();
    this.applied = new Set();
    this.activities = [];
    this.conflicts = [];
    this.checkpoint = { revision: 0, vector: {}, at: 0 };
    this.load();
  }

  get key() {
    return `${this.storagePrefix}:${this.roomId}:${this.actorId}`;
  }

  setRoom(roomId) {
    this.roomId = String(roomId || this.roomId);
    this.entries.clear();
    this.applied.clear();
    this.activities = [];
    this.conflicts = [];
    this.checkpoint = { revision: 0, vector: {}, at: 0 };
    this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem?.(this.key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.entries = new Map((data.entries || []).map((entry) => [entry.operation.opId, normalizeEntry(entry)]));
      this.applied = new Set(data.applied || []);
      this.activities = Array.from(data.activities || []).slice(-this.maxEntries);
      this.conflicts = Array.from(data.conflicts || []).slice(-200);
      this.checkpoint = { ...this.checkpoint, ...(data.checkpoint || {}) };
      return true;
    } catch (_) {
      return false;
    }
  }

  persist() {
    const snapshot = this.snapshot();
    try {
      this.storage?.setItem?.(this.key, JSON.stringify(snapshot));
      return true;
    } catch (_) {
      return false;
    }
  }

  enqueue(operation, { peers = [], summary = '', messageId = '' } = {}) {
    if (!operation?.opId) return null;
    if (this.entries.has(operation.opId)) return this.entries.get(operation.opId);
    const at = this.now();
    const entry = normalizeEntry({
      operation: structuredCloneSafe(operation),
      messageId,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
      attempts: 0,
      nextRetryAt: at,
      expectedPeers: peers,
      acknowledgements: [],
      summary: summary || summarizeOperation(operation, { actorLabel: 'You' }),
    });
    this.entries.set(operation.opId, entry);
    this.addActivity({ type: 'local', status: 'pending', opId: operation.opId, summary: entry.summary, at });
    this.compact();
    this.persist();
    return entry;
  }

  markSent(opId, { delivered = false, peerCount = 0, retryDelay = 800, error = '' } = {}) {
    const entry = this.entries.get(opId);
    if (!entry) return null;
    entry.attempts += 1;
    entry.lastSentAt = this.now();
    entry.updatedAt = entry.lastSentAt;
    entry.delivered = Boolean(delivered);
    entry.peerCount = Math.max(entry.peerCount, Number(peerCount || 0));
    entry.lastError = String(error || '');
    entry.nextRetryAt = entry.lastSentAt + Math.max(100, Number(retryDelay || 800));
    entry.status = entry.attempts > 1 ? 'retrying' : 'pending';
    this.persist();
    return entry;
  }

  acknowledge(opId, peerId, { result = 'applied', reason = '', at = this.now() } = {}) {
    const entry = this.entries.get(opId);
    if (!entry) return null;
    const existing = entry.acknowledgements.find((ack) => ack.peerId === peerId);
    const ack = { peerId: String(peerId || 'peer'), result, reason: String(reason || ''), at: Number(at) };
    if (existing) Object.assign(existing, ack);
    else entry.acknowledgements.push(ack);
    entry.updatedAt = Number(at);
    if (result === 'rejected' || result === 'needs-snapshot') {
      entry.status = 'rejected';
      entry.lastError = reason || result;
    } else if (this.isFullyAcknowledged(entry)) entry.status = 'acknowledged';
    else entry.status = 'partially-acknowledged';
    this.addActivity({ type: 'ack', status: entry.status, opId, summary: `${entry.summary} · ${result}`, at: Number(at), peerId });
    this.persist();
    return entry;
  }

  isFullyAcknowledged(entry) {
    if (!entry) return false;
    if (!entry.expectedPeers.length) return entry.acknowledgements.some((ack) => ['applied', 'duplicate'].includes(ack.result));
    const accepted = new Set(entry.acknowledgements.filter((ack) => ['applied', 'duplicate'].includes(ack.result)).map((ack) => ack.peerId));
    return entry.expectedPeers.every((peerId) => accepted.has(peerId));
  }

  markApplied(operation, { summary = '', actorLabel = '', at = this.now() } = {}) {
    if (!operation?.opId || this.applied.has(operation.opId)) return false;
    this.applied.add(operation.opId);
    this.addActivity({
      type: 'remote',
      status: 'applied',
      opId: operation.opId,
      summary: summary || summarizeOperation(operation, { actorLabel }),
      at: Number(at),
      actorId: operation.actorId,
    });
    this.compact();
    this.persist();
    return true;
  }

  hasApplied(opId) {
    return this.applied.has(opId);
  }

  addConflict(conflict = {}) {
    const normalized = { id: conflict.id || `conflict:${this.now()}:${this.conflicts.length + 1}`, at: this.now(), status: 'open', ...structuredCloneSafe(conflict) };
    this.conflicts.push(normalized);
    this.conflicts = this.conflicts.slice(-200);
    this.addActivity({ type: 'conflict', status: normalized.status, summary: normalized.summary || 'Operation conflict requires attention', at: normalized.at, conflictId: normalized.id });
    this.persist();
    return normalized;
  }

  resolveConflict(conflictId, resolution) {
    const conflict = this.conflicts.find((item) => item.id === conflictId);
    if (!conflict) return null;
    conflict.status = 'resolved';
    conflict.resolution = resolution;
    conflict.resolvedAt = this.now();
    this.persist();
    return conflict;
  }

  dueOperations(at = this.now()) {
    return [...this.entries.values()].filter((entry) => ['pending', 'retrying', 'partially-acknowledged'].includes(entry.status) && entry.nextRetryAt <= at);
  }

  pendingOperations() {
    return [...this.entries.values()].filter((entry) => !['acknowledged', 'discarded'].includes(entry.status));
  }

  setExpectedPeers(peerIds = []) {
    const peers = [...new Set(peerIds.filter(Boolean).map(String))];
    for (const entry of this.entries.values()) {
      if (!['pending', 'retrying', 'partially-acknowledged'].includes(entry.status)) continue;
      entry.expectedPeers = peers;
      if (this.isFullyAcknowledged(entry)) entry.status = 'acknowledged';
    }
    this.persist();
  }

  setCheckpoint({
    revision = 0,
    vector = {},
    at = this.now(),
    status = 'checkpoint',
    summary = '',
  } = {}) {
    this.checkpoint = { revision: Number(revision || 0), vector: { ...vector }, at: Number(at) };
    this.addActivity({
      type: 'checkpoint',
      status,
      summary: summary || `Snapshot checkpoint ${this.checkpoint.revision}`,
      at: Number(at),
    });
    this.compact({ force: true });
    this.persist();
  }

  addActivity(activity = {}) {
    this.activities.push({ at: this.now(), ...structuredCloneSafe(activity) });
    this.activities = this.activities.slice(-this.maxEntries);
  }

  compact({ force = false } = {}) {
    const acknowledged = [...this.entries.values()].filter((entry) => entry.status === 'acknowledged').sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.entries.size > this.maxEntries && acknowledged.length) this.entries.delete(acknowledged.shift().operation.opId);
    if (force || this.entries.size >= 250) {
      const retainAcknowledged = 100;
      while (acknowledged.length > retainAcknowledged) this.entries.delete(acknowledged.shift().operation.opId);
    }
    while (this.applied.size > this.maxEntries) this.applied.delete(this.applied.values().next().value);
    let json = '';
    try {
      json = JSON.stringify(this.snapshot());
    } catch (_) {}
    while (json.length > this.maxBytes && acknowledged.length) {
      this.entries.delete(acknowledged.shift().operation.opId);
      json = JSON.stringify(this.snapshot());
    }
  }

  clearAcknowledged() {
    for (const [opId, entry] of this.entries) if (entry.status === 'acknowledged') this.entries.delete(opId);
    this.persist();
  }

  discard(opId) {
    const entry = this.entries.get(opId);
    if (!entry) return false;
    entry.status = 'discarded';
    entry.updatedAt = this.now();
    this.persist();
    return true;
  }

  diagnostics() {
    const counts = { pending: 0, retrying: 0, acknowledged: 0, rejected: 0, partial: 0 };
    for (const entry of this.entries.values()) {
      if (entry.status === 'retrying') counts.retrying += 1;
      else if (entry.status === 'acknowledged') counts.acknowledged += 1;
      else if (entry.status === 'rejected') counts.rejected += 1;
      else if (entry.status === 'partially-acknowledged') counts.partial += 1;
      else if (entry.status === 'pending') counts.pending += 1;
    }
    return {
      roomId: this.roomId,
      actorId: this.actorId,
      counts,
      pendingCount: counts.pending + counts.retrying + counts.partial + counts.rejected,
      conflictCount: this.conflicts.filter((item) => item.status !== 'resolved').length,
      appliedCount: this.applied.size,
      checkpoint: { ...this.checkpoint },
      newestActivityAt: this.activities.at(-1)?.at || 0,
    };
  }

  snapshot() {
    return {
      roomId: this.roomId,
      actorId: this.actorId,
      entries: [...this.entries.values()].map((entry) => structuredCloneSafe(entry)),
      applied: [...this.applied],
      activities: structuredCloneSafe(this.activities),
      conflicts: structuredCloneSafe(this.conflicts),
      checkpoint: structuredCloneSafe(this.checkpoint),
    };
  }
}

function normalizeEntry(entry = {}) {
  return {
    operation: structuredCloneSafe(entry.operation || {}),
    messageId: String(entry.messageId || ''),
    status: entry.status || 'pending',
    createdAt: Number(entry.createdAt || Date.now()),
    updatedAt: Number(entry.updatedAt || entry.createdAt || Date.now()),
    attempts: Number(entry.attempts || 0),
    nextRetryAt: Number(entry.nextRetryAt || 0),
    lastSentAt: Number(entry.lastSentAt || 0),
    delivered: Boolean(entry.delivered),
    peerCount: Number(entry.peerCount || 0),
    expectedPeers: [...new Set((entry.expectedPeers || []).map(String))],
    acknowledgements: Array.from(entry.acknowledgements || []).map((ack) => ({ ...ack })),
    lastError: String(entry.lastError || ''),
    summary: String(entry.summary || ''),
  };
}
