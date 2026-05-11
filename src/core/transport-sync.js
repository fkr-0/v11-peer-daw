// PeerModGroove/src/core/transport-sync.js
export class TransportSync {
  constructor({ smoothing = 0.12 } = {}) {
    this.latencyMs = 0;
    this.clockOffsetMs = 0;
    this.driftMs = 0;
    this.smoothing = smoothing;
    this.lastTick = null;
  }
  observePing({ sentAt, receivedAt = Date.now(), remoteNow = receivedAt } = {}) {
    const rttMs = Math.max(0, receivedAt - sentAt);
    const oneWayMs = rttMs / 2;
    const offset = remoteNow - (sentAt + oneWayMs);
    this.latencyMs = smooth(this.latencyMs, oneWayMs, this.smoothing);
    this.clockOffsetMs = smooth(this.clockOffsetMs, offset, this.smoothing);
    return { rttMs, oneWayMs: this.latencyMs, clockOffsetMs: this.clockOffsetMs };
  }
  observeTick(payload, now = Date.now()) {
    if (!payload) return this.driftMs;
    const expected = Number(payload.dueAt || now);
    const measured = expected - now;
    const target = Math.max(-80, Math.min(80, -measured * 0.08));
    this.driftMs = smooth(this.driftMs, target, this.smoothing);
    this.lastTick = payload;
    return this.driftMs;
  }
  correctedDueAt(payload) {
    return (
      Number(payload?.dueAt || Date.now()) + this.latencyMs + this.clockOffsetMs + this.driftMs
    );
  }
}
function smooth(a, b, f) {
  return a + (b - a) * f;
}

export function electAuthority(peers = [], localId = '') {
  const candidates = [localId, ...peers].filter(Boolean).map(String).sort();
  return candidates[0] || '';
}

export function authorityExpired(lastTickAt, now = Date.now(), timeoutMs = 1800) {
  return Boolean(lastTickAt) && now - lastTickAt > timeoutMs;
}

export function shouldAcceptAuthority(currentAuthority, candidateAuthority, localId = '') {
  if (!candidateAuthority) return false;
  if (!currentAuthority) return true;
  if (candidateAuthority === currentAuthority) return true;
  return String(candidateAuthority) < String(currentAuthority || localId || 'zzzz');
}
