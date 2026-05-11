// PeerModGroove/src/adapters/monaco-crdt-editor-adapter.js
// Monaco integration for the TextCrdt engine + unified Peernet lobby transport.

import { anchorsToSelection, diffToOps, selectionToAnchors } from '../crdt/text-crdt.js';
import { CrdtEditorAdapter } from './crdt-editor-adapter.js';

export class MonacoCrdtEditorAdapter extends CrdtEditorAdapter {
  constructor(monacoEditor, opts = {}) {
    const shim = monacoToTextareaLike(monacoEditor);
    super(shim, opts);
    this.monaco = monacoEditor;
    this.decorations = [];
  }

  start() {
    this.stack.start(this.profile);
    if (typeof this.stack.joinLobby === 'function') this.stack.joinLobby(`artifact:${this.docId}`);

    this.monaco.onDidChangeModelContent(() => this.handleLocalInput());
    this.monaco.onDidChangeCursorSelection(() => this.broadcastCursor());

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

    this.broadcastPresence();
    this.emit('ready', { docId: this.docId, siteId: this.doc.siteId });
    return this;
  }

  handleLocalInput() {
    if (this.silent) return;
    const before = this.text;
    const next = this.monaco.getValue();
    const ops = diffToOps(this.doc, before, next);
    if (!ops.length) return;
    this.text = this.doc.value();
    this.undoStack.push({ before, after: this.text });
    this.redoStack.length = 0;
    this.queueOps(ops);
  }

  broadcastCursor() {
    const model = this.monaco.getModel();
    const sel = this.monaco.getSelection();
    if (!model || !sel) return;
    const start = model.getOffsetAt(sel.getStartPosition());
    const end = model.getOffsetAt(sel.getEndPosition());
    const message = {
      docId: this.docId,
      siteId: this.doc.siteId,
      profile: this.profile,
      selection: selectionToAnchors(this.doc, start, end),
      at: Date.now(),
    };
    if (typeof this.stack.broadcast === 'function') this.stack.broadcast('crdt-cursor', message);
    else this.stack.core?.broadcast?.({ type: 'artifact:crdt-cursor', data: message });
  }

  renderRemote() {
    const next = this.doc.value();
    if (next === this.text) return;
    const model = this.monaco.getModel();
    const selection = this.monaco.getSelection();
    const offset = model && selection ? model.getOffsetAt(selection.getPosition()) : next.length;
    this.silent = true;
    this.monaco.setValue(next);
    this.text = next;
    const updated = this.monaco.getModel();
    if (updated) this.monaco.setPosition(updated.getPositionAt(Math.min(offset, next.length)));
    this.silent = false;
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
    this.renderCursorDecorations();
    this.emit('cursor', cursor);
  }

  renderCursorDecorations() {
    const model = this.monaco.getModel();
    if (!model || !globalThis.monaco) return;
    const decorations = [];
    for (const cursor of this.remoteCursors.values()) {
      const start = model.getPositionAt(cursor.start ?? cursor.index ?? 0);
      const end = model.getPositionAt(cursor.end ?? cursor.focusIndex ?? cursor.index ?? 0);
      if ((cursor.end ?? 0) > (cursor.start ?? 0)) {
        decorations.push({
          range: new globalThis.monaco.Range(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column
          ),
          options: {
            className: 'remote-crdt-selection',
            hoverMessage: { value: cursor.profile?.username || cursor.siteId },
          },
        });
      }
      const caret = model.getPositionAt(cursor.focusIndex ?? cursor.index ?? 0);
      decorations.push({
        range: new globalThis.monaco.Range(
          caret.lineNumber,
          caret.column,
          caret.lineNumber,
          caret.column
        ),
        options: {
          className: 'remote-crdt-cursor',
          hoverMessage: { value: cursor.profile?.username || cursor.siteId },
          stickiness: globalThis.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
    this.decorations = this.monaco.deltaDecorations(this.decorations, decorations);
  }
}

function monacoToTextareaLike(editor) {
  return {
    get value() {
      return editor.getValue();
    },
    set value(v) {
      editor.setValue(v);
    },
    get selectionStart() {
      const model = editor.getModel();
      const sel = editor.getSelection();
      return model && sel ? model.getOffsetAt(sel.getStartPosition()) : 0;
    },
    get selectionEnd() {
      const model = editor.getModel();
      const sel = editor.getSelection();
      return model && sel ? model.getOffsetAt(sel.getEndPosition()) : 0;
    },
    addEventListener() {},
    setSelectionRange(start, end = start) {
      const model = editor.getModel();
      if (!model) return;
      const a = model.getPositionAt(start);
      const b = model.getPositionAt(end);
      editor.setSelection({
        startLineNumber: a.lineNumber,
        startColumn: a.column,
        endLineNumber: b.lineNumber,
        endColumn: b.column,
      });
    },
  };
}
