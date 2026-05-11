// PeerModGroove/src/crdt/text-crdt.js
// Operation-based sequence CRDT for artifact text editors.
//
// Design notes:
// - Each character has a stable globally unique id: <siteId>:<counter>
// - Inserts reference the visible/tombstoned character before them via afterId
// - Deletes are tombstones so late operations can still resolve
// - Local ordered insert runs are preserved by chaining each inserted char after the previous char
// - Concurrent siblings under the same afterId are deterministically ordered by id

export class TextCrdt {
  constructor({ siteId = randomSiteId(), clock = 0 } = {}) {
    this.siteId = siteId;
    this.clock = clock;
    this.nodes = new Map();
    this.children = new Map();
    this.applied = new Set();
    this.rootId = 'ROOT';
    this.children.set(this.rootId, []);
  }

  static fromText(text, opts = {}) {
    const doc = new TextCrdt(opts);
    let afterId = doc.rootId;
    for (const ch of String(text || '')) {
      const op = doc.localInsertAfter(afterId, ch);
      afterId = op.id;
    }
    return doc;
  }

  nextId() {
    this.clock += 1;
    return `${this.siteId}:${this.clock}`;
  }

  value() {
    let out = '';
    this.walkVisible((node) => {
      out += node.value;
    });
    return out;
  }

  visibleIds() {
    const ids = [];
    this.walkVisible((node) => ids.push(node.id));
    return ids;
  }

  localInsert(index, value) {
    const chars = Array.from(String(value || ''));
    const ops = [];
    const ids = this.visibleIds();
    const clamped = Math.max(0, Math.min(Number(index || 0), ids.length));
    let afterId = clamped <= 0 ? this.rootId : ids[clamped - 1] || this.rootId;
    let beforeId = ids[clamped] || null;
    if (beforeId) {
      const beforeNode = this.nodes.get(beforeId);
      if (beforeNode?.afterId) afterId = beforeNode.afterId;
    }
    for (const ch of chars) {
      const op = this.localInsertAfter(afterId, ch, beforeId);
      op.index = clamped + ops.length;
      ops.push(op);
      afterId = op.id;
      beforeId = null;
    }
    return ops;
  }

  localInsertAfter(afterId, value, beforeId = null) {
    const op = {
      kind: 'insert',
      id: this.nextId(),
      afterId: afterId || this.rootId,
      beforeId,
      value,
      siteId: this.siteId,
    };
    this.apply(op);
    return op;
  }

  localDelete(index, count = 1) {
    const ids = this.visibleIds().slice(index, index + count);
    return ids.map((id) => {
      const op = { kind: 'delete', id, siteId: this.siteId, opId: this.nextId() };
      this.apply(op);
      return op;
    });
  }

  apply(op) {
    if (!op || typeof op !== 'object') return false;
    const key = op.opId || `${op.kind}:${op.id}`;
    if (this.applied.has(key)) return false;

    let changed = false;
    if (op.kind === 'insert') changed = this.applyInsert(op);
    else if (op.kind === 'delete') changed = this.applyDelete(op);

    if (changed) this.applied.add(key);
    return changed;
  }

  applyMany(ops = []) {
    let changed = false;
    for (const op of ops) changed = this.apply(op) || changed;
    return changed;
  }

  applyInsert(op) {
    if (!op.id || this.nodes.has(op.id)) return false;
    let afterId = op.afterId || this.rootId;
    let beforeId = op.beforeId || null;
    if (afterId !== this.rootId && !this.nodes.has(afterId)) {
      const ids = this.visibleIds();
      const index = Math.max(0, Math.min(Number(op.index || 0), ids.length));
      afterId = index <= 0 ? this.rootId : ids[index - 1] || this.rootId;
      beforeId = ids[index] || null;
      if (beforeId) {
        const beforeNode = this.nodes.get(beforeId);
        if (beforeNode?.afterId) afterId = beforeNode.afterId;
      }
    }
    const node = {
      id: op.id,
      afterId,
      beforeId,
      value: String(op.value ?? ''),
      deleted: false,
      siteId: op.siteId || parseSiteId(op.id),
    };
    this.nodes.set(node.id, node);
    if (!this.children.has(afterId)) this.children.set(afterId, []);
    if (!this.children.has(node.id)) this.children.set(node.id, []);

    const siblings = this.children.get(afterId);
    if (!siblings.includes(node.id)) {
      let i = node.beforeId ? siblings.indexOf(node.beforeId) : -1;
      if (i < 0 && node.beforeId && Number.isFinite(Number(op.index))) {
        const ids = this.visibleIds();
        const fallbackBeforeId = ids[Math.max(0, Number(op.index))] || null;
        if (fallbackBeforeId && this.nodes.get(fallbackBeforeId)?.afterId === afterId) {
          i = siblings.indexOf(fallbackBeforeId);
          node.beforeId = fallbackBeforeId;
        }
      }
      if (i < 0) {
        i = 0;
        while (i < siblings.length && compareIds(siblings[i], node.id) < 0) i += 1;
      }
      siblings.splice(i, 0, node.id);
    }

    this.clock = Math.max(this.clock, parseClock(op.id));
    return true;
  }

  applyDelete(op) {
    let node = this.nodes.get(op.id);
    if ((!node || node.deleted) && Number.isFinite(Number(op.index))) {
      const fallbackId = this.visibleIds()[Math.max(0, Number(op.index))];
      node = fallbackId ? this.nodes.get(fallbackId) : null;
    }
    if (!node || node.deleted) return false;
    node.deleted = true;
    this.clock = Math.max(this.clock, parseClock(op.opId || ''));
    return true;
  }

  snapshot() {
    return {
      siteId: this.siteId,
      clock: this.clock,
      nodes: Array.from(this.nodes.values()),
      applied: Array.from(this.applied),
    };
  }

  loadSnapshot(snapshot = {}) {
    this.clock = Math.max(this.clock, Number(snapshot.clock || 0));
    this.nodes.clear();
    this.children.clear();
    this.children.set(this.rootId, []);
    this.applied = new Set(snapshot.applied || []);

    for (const raw of snapshot.nodes || []) {
      const node = { ...raw, afterId: raw.afterId || this.rootId };
      this.nodes.set(node.id, node);
      if (!this.children.has(node.afterId)) this.children.set(node.afterId, []);
      if (!this.children.has(node.id)) this.children.set(node.id, []);
      this.children.get(node.afterId).push(node.id);
    }

    for (const siblings of this.children.values()) siblings.sort(compareIds);
  }

  compact() {
    const live = this.value();
    const compacted = TextCrdt.fromText(live, { siteId: this.siteId, clock: this.clock });
    this.clock = compacted.clock;
    this.nodes = compacted.nodes;
    this.children = compacted.children;
    this.applied = compacted.applied;
    return this.snapshot();
  }

  afterIdForIndex(index) {
    const ids = this.visibleIds();
    const clamped = Math.max(0, Math.min(Number(index || 0), ids.length));
    if (clamped <= 0) return this.rootId;
    return ids[clamped - 1] || this.rootId;
  }

  walkVisible(fn) {
    const walk = (parentId) => {
      const childIds = this.children.get(parentId) || [];
      for (const id of childIds) {
        const node = this.nodes.get(id);
        if (!node) continue;
        if (!node.deleted) fn(node);
        walk(id);
      }
    };
    walk(this.rootId);
  }
}

export function diffToOps(doc, oldText, newText) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start])
    start += 1;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const ops = [];
  const deleteCount = oldEnd - start;
  if (deleteCount > 0) {
    const deleteOps = doc.localDelete(start, deleteCount).map((op) => ({ ...op, index: start }));
    ops.push(...deleteOps);
  }
  const insertText = newText.slice(start, newEnd);
  if (insertText) {
    const insertOps = doc
      .localInsert(start, insertText)
      .map((op, offset) => ({ ...op, index: start + offset }));
    ops.push(...insertOps);
  }
  return ops;
}

export function cursorToAnchor(doc, index, bias = 'right') {
  const ids = doc.visibleIds();
  const clamped = Math.max(0, Math.min(Number(index || 0), ids.length));
  return {
    leftId: clamped <= 0 ? doc.rootId : ids[clamped - 1] || doc.rootId,
    rightId: ids[clamped] || null,
    offset: clamped,
    bias,
  };
}

export function anchorToCursor(doc, anchor = {}) {
  const ids = doc.visibleIds();
  const leftIndex = anchor.leftId && anchor.leftId !== doc.rootId ? ids.indexOf(anchor.leftId) : -1;
  const rightIndex = anchor.rightId ? ids.indexOf(anchor.rightId) : -1;

  if (anchor.bias === 'left') {
    if (leftIndex !== -1) return leftIndex + 1;
    if (anchor.leftId === doc.rootId) return 0;
    if (rightIndex !== -1) return rightIndex;
  }

  if (rightIndex !== -1) return rightIndex;
  if (leftIndex !== -1) return leftIndex + 1;
  if (anchor.leftId === doc.rootId) return 0;
  return ids.length;
}

export function selectionToAnchors(doc, start, end = start) {
  return {
    anchor: cursorToAnchor(doc, start, 'left'),
    focusAnchor: cursorToAnchor(doc, end, 'right'),
    reversed: Number(start || 0) > Number(end || 0),
  };
}

export function anchorsToSelection(doc, selection = {}) {
  const anchorIndex = anchorToCursor(doc, selection.anchor);
  const focusIndex = anchorToCursor(doc, selection.focusAnchor || selection.anchor);
  return {
    anchorIndex,
    focusIndex,
    start: Math.min(anchorIndex, focusIndex),
    end: Math.max(anchorIndex, focusIndex),
    reversed: Boolean(selection.reversed),
  };
}

function randomSiteId() {
  return `site-${Math.random().toString(36).slice(2, 10)}`;
}

function parseSiteId(id) {
  return String(id || '').split(':')[0] || 'unknown';
}

function parseClock(id) {
  const n = Number(String(id || '').split(':')[1]);
  return Number.isFinite(n) ? n : 0;
}

function compareIds(a, b) {
  const [as, ac] = String(a).split(':');
  const [bs, bc] = String(b).split(':');
  const an = Number(ac);
  const bn = Number(bc);
  if (an !== bn) return an - bn;
  return as.localeCompare(bs);
}
