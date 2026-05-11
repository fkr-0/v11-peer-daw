// PeerModGroove/src/core/jitter-buffer.js
export class JitterBuffer {
  constructor({ minLeadMs = 35, maxLeadMs = 220 } = {}) {
    this.minLeadMs = minLeadMs;
    this.maxLeadMs = maxLeadMs;
    this.queue = [];
  }
  push(event) {
    if (!event) return;
    this.queue.push(event);
    this.queue.sort((a, b) => Number(a.dueAt || 0) - Number(b.dueAt || 0));
  }
  drain(now = Date.now(), horizonMs = this.maxLeadMs) {
    const ready = [];
    const keep = [];
    for (const event of this.queue) {
      const due = Number(event.dueAt || now);
      if (due <= now + horizonMs) ready.push(event);
      else keep.push(event);
    }
    this.queue = keep;
    return ready;
  }
  normalizeDueAt(event, now = Date.now()) {
    const due = Number(event?.dueAt || now);
    return { ...event, dueAt: Math.max(now + this.minLeadMs, Math.min(due, now + this.maxLeadMs)) };
  }
}
