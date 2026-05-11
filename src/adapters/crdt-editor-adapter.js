// PeerModGroove/src/adapters/crdt-editor-adapter.js
// CRDT-backed adapter for textarea-like editors operating through PeernetStack.

import { PeernetStack } from '../core/peernet-stack.js';
import { TextCrdt, anchorsToSelection, diffToOps, selectionToAnchors } from '../crdt/text-crdt.js';

export class CrdtEditorAdapter extends EventTarget {
  constructor(editor, opts = {}) {
    super();
    this.editor = editor;
    this.docId = opts.docId || 'default';
    this.profile = opts.profile || {};
    this.silent = false;
    this.text = editor.value || '';
    this.remoteCursors = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.pendingOps = [];
    this.flushTimer = null;
    this.batchMs = opts.batchMs ?? 50;
    this.doc = TextCrdt.fromText(this.text, { siteId: opts.siteId || persistedSiteId(this.docId) });
    this.stack =
      opts.stack ||
      new PeernetStack({
        namespace: opts.namespace || `artifact-editor:${this.docId}`,
        capture: () => this.snapshot(),
        apply: (snapshot) => this.applySnapshot(snapshot),
      });
  }

  start() {
    this.stack.start(this.profile);
    if (typeof this.stack.joinLobby === 'function') this.stack.joinLobby(`artifact:${this.docId}`);

    this.editor.addEventListener('input', () => this.handleLocalInput());
    this.editor.addEventListener('keyup', () => this.broadcastCursor());
    this.editor.addEventListener('click', () => this.broadcastCursor());
    this.editor.addEventListener('select', () => this.broadcastCursor());

    const onOps = (payload) => this.receiveOps(payload?.data || payload);
    const onCursor = (payload) => this.receiveCursor(payload?.data || payload);
    const onPresence = (payload) => this.receivePresence(payload?.data || payload);
    if (typeof this.stack.onMessage === 'function') {
      this.stack.onMessage('crdt-ops', onOps);
      this.stack.onMessage('crdt-cursor', onCursor);
      this.stack.onMessage('presence', onPresence);
    } else {
      this.stack.core?.on?.('message:artifact:crdt-ops', onOps);
      this.stack.core?.on?.('message:artifact:crdt-cursor', onCursor);
      this.stack.core?.on?.('message:artifact:presence', onPresence);
    }

    this.stack.addEventListener?.('presence', (event) => this.emit('presence', event.detail));
    this.broadcastPresence();
    this.emit('ready', { docId: this.docId, siteId: this.doc.siteId });
    return this;
  }

  handleLocalInput() {
    if (this.silent) return;
    const before = this.text;
    const next = this.editor.value;
    const ops = diffToOps(this.doc, before, next);
    if (!ops.length) return;
    this.text = this.doc.value();
    this.undoStack.push({ before, after: this.text });
    this.redoStack.length = 0;
    this.queueOps(ops);
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push({ before: this.text, after: entry.after });
    return this.replaceLocalText(entry.before, false);
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push({ before: this.text, after: entry.before });
    return this.replaceLocalText(entry.after, false);
  }

  replaceLocalText(next, recordUndo = true) {
    const before = this.text;
    const ops = diffToOps(this.doc, before, next);
    if (!ops.length) return false;
    if (recordUndo) this.undoStack.push({ before, after: next });
    this.text = this.doc.value();
    this.silent = true;
    this.editor.value = this.text;
    this.silent = false;
    this.queueOps(ops);
    return true;
  }

  receiveOps(message = {}) {
    if (!message || message.docId !== this.docId || message.siteId === this.doc.siteId) return;
    const changed = this.doc.applyMany(message.ops || []);
    if (!changed) {
      // Defensive sync: tests and editor integrations may hand us a CRDT that was
      // mutated by a compatible adapter before the network envelope arrives. In
      // that case no op key is newly applied, but the rendered editor can still
      // be stale.
      if (this.doc.value() !== this.text) this.renderRemote();
      return;
    }
    this.renderRemote();
    this.emit('remote-change', message);
  }

  queueOps(ops) {
    this.pendingOps.push(...ops);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushOps(), this.batchMs);
  }

  flushOps() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const ops = this.pendingOps.splice(0);
    if (ops.length) this.broadcastOps(ops);
  }

  broadcastCursor() {
    const message = {
      docId: this.docId,
      siteId: this.doc.siteId,
      profile: this.profile,
      selection: selectionToAnchors(
        this.doc,
        this.editor.selectionStart || 0,
        this.editor.selectionEnd || this.editor.selectionStart || 0
      ),
      at: Date.now(),
    };
    if (typeof this.stack.broadcast === 'function') this.stack.broadcast('crdt-cursor', message);
    else this.stack.core?.broadcast?.({ type: 'artifact:crdt-cursor', data: message });
  }

  receiveCursor(message = {}) {
    if (!message || message.docId !== this.docId || message.siteId === this.doc.siteId) return;
    const cursor = {
      ...message,
      ...anchorsToSelection(
        this.doc,
        message.selection || { anchor: message.anchor, focusAnchor: message.focusAnchor }
      ),
    };
    this.remoteCursors.set(message.siteId, cursor);
    this.emit('cursor', cursor);
  }

  broadcastPresence() {
    const message = {
      docId: this.docId,
      siteId: this.doc.siteId,
      profile: this.profile,
      at: Date.now(),
    };
    if (typeof this.stack.broadcast === 'function') this.stack.broadcast('presence', message);
    else this.stack.core?.broadcast?.({ type: 'artifact:presence', data: message });
  }

  receivePresence(message = {}) {
    if (!message || message.docId !== this.docId || message.siteId === this.doc.siteId) return;
    this.emit('peer-presence', message);
  }

  broadcastOps(ops) {
    const message = {
      docId: this.docId,
      siteId: this.doc.siteId,
      profile: this.profile,
      ops,
      textClock: this.doc.clock,
      at: Date.now(),
    };
    if (typeof this.stack.broadcast === 'function') this.stack.broadcast('crdt-ops', message);
    else this.stack.core?.broadcast?.({ type: 'artifact:crdt-ops', data: message });
    this.emit('local-change', message);
  }

  compact() {
    this.doc.compact();
    this.text = this.doc.value();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.renderRemote();
    this.emit('compact', this.snapshot());
  }

  renderRemote() {
    const next = this.doc.value();
    if (next === this.text) return;
    const selectionStart = this.editor.selectionStart;
    const selectionEnd = this.editor.selectionEnd;
    this.silent = true;
    this.editor.value = next;
    this.text = next;
    const clampedStart = Math.min(selectionStart ?? next.length, next.length);
    const clampedEnd = Math.min(selectionEnd ?? clampedStart, next.length);
    this.editor.setSelectionRange?.(clampedStart, clampedEnd);
    this.silent = false;
  }

  snapshot() {
    return {
      kind: 'artifact-editor-crdt',
      docId: this.docId,
      text: this.doc.value(),
      crdt: this.doc.snapshot(),
    };
  }

  applySnapshot(snapshot = {}) {
    if (snapshot.docId && snapshot.docId !== this.docId) return;
    if (snapshot.crdt) this.doc.loadSnapshot(snapshot.crdt);
    this.renderRemote();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function persistedSiteId(docId) {
  const key = `artifact-editor:${docId}:site-id`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = `site-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}
