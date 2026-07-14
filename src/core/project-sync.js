export const PROJECT_SYNC_CHANNEL = 'daw-project-sync';
export const PROJECT_SYNC_PROTOCOL = 1;

const KIND_TO_TYPE = Object.freeze({
  request: 'project-request',
  snapshot: 'project-snapshot',
  update: 'project-update',
  ack: 'project-ack',
});

export class ProjectSyncState {
  constructor({ clientId, sessionCode, maxSeen = 512 } = {}) {
    this.clientId = String(clientId || 'client');
    this.sessionCode = String(sessionCode || 'V11-OPEN-STUDIO');
    this.maxSeen = Math.max(32, Number(maxSeen || 512));
    this.sequence = 0;
    this.seen = new Set();
    this.activity = new Map();
    this.lastAckAt = 0;
    this.lastAckClientId = '';
  }

  setSessionCode(sessionCode) {
    this.sessionCode = String(sessionCode || this.sessionCode);
    this.seen.clear();
    this.activity.clear();
    this.lastAckAt = 0;
    this.lastAckClientId = '';
  }

  create(kind, payload = {}) {
    const type = KIND_TO_TYPE[kind] || kind;
    const at = Date.now();
    return {
      protocol: PROJECT_SYNC_PROTOCOL,
      type,
      messageId: `${this.clientId}:${at.toString(36)}:${++this.sequence}`,
      clientId: this.clientId,
      sessionCode: this.sessionCode,
      at,
      ...payload,
    };
  }

  accept(message, { transport = 'unknown', receivedAt = Date.now() } = {}) {
    if (!message || typeof message !== 'object') return false;
    if (message.protocol !== PROJECT_SYNC_PROTOCOL) return false;
    if (!message.messageId || !message.clientId) return false;
    if (message.clientId === this.clientId) return false;
    if (message.sessionCode !== this.sessionCode) return false;
    if (this.seen.has(message.messageId)) return false;
    this.remember(message.messageId);
    this.markReceived(transport, receivedAt);
    return true;
  }

  remember(messageId) {
    this.seen.add(messageId);
    while (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value);
  }

  transport(transport = 'unknown') {
    if (!this.activity.has(transport)) {
      this.activity.set(transport, {
        sentAt: 0,
        receivedAt: 0,
        delivered: false,
        peerCount: 0,
      });
    }
    return this.activity.get(transport);
  }

  markSent(transport, delivery = {}) {
    const activity = this.transport(transport);
    activity.sentAt = Number(delivery.sentAt || Date.now());
    activity.delivered = Boolean(delivery.delivered);
    activity.peerCount = Number(delivery.peerCount || 0);
    return activity;
  }

  markReceived(transport, receivedAt = Date.now()) {
    const activity = this.transport(transport);
    activity.receivedAt = Number(receivedAt || Date.now());
    return activity;
  }

  markAck(message = {}) {
    this.lastAckAt = Number(message.at || Date.now());
    this.lastAckClientId = String(message.clientId || '');
  }

  diagnostics() {
    return {
      transports: Object.fromEntries(
        [...this.activity.entries()].map(([name, value]) => [name, { ...value }])
      ),
      lastAckAt: this.lastAckAt,
      lastAckClientId: this.lastAckClientId,
      seenCount: this.seen.size,
    };
  }
}
