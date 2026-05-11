/* peernet-storage-manager.js
 * Living localStorage manager: namespaced snapshots, autosave, retention, export/import.
 * Headless and app-neutral.
 */
(function (global) {
  'use strict';
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function key(ns, part) { return ns + ':' + part; }
  function now() { return Date.now(); }
  function id(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }

  function StorageManager(opts) {
    opts = opts || {};
    this.namespace = opts.namespace || 'peernet-storage';
    this.maxSnapshots = opts.maxSnapshots || 25;
    this.autosaveMs = opts.autosaveMs || 15000;
    this.capture = opts.capture || function () { return {}; };
    this.apply = opts.apply || function () {};
    this.listeners = {};
    this.timer = null;
    this.index = this.loadIndex();
    this.gc();
  }

  StorageManager.prototype.on = function (event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
    return this;
  };

  StorageManager.prototype.emit = function (event, payload) {
    (this.listeners[event] || []).forEach(function (fn) { try { fn(payload); } catch (e) { console.warn('[PeernetStorageManager]', e); } });
  };

  StorageManager.prototype.loadIndex = function () {
    try { return JSON.parse(localStorage.getItem(key(this.namespace, 'index')) || '[]'); }
    catch (_) { return []; }
  };

  StorageManager.prototype.saveIndex = function () {
    localStorage.setItem(key(this.namespace, 'index'), JSON.stringify(this.index));
  };

  StorageManager.prototype.snapshot = function (meta, payload) {
    var snap = {
      id: id('snap'),
      title: (meta && meta.title) || 'Snapshot ' + new Date().toLocaleTimeString(),
      app: (meta && meta.app) || 'app',
      kind: (meta && meta.kind) || 'manual',
      createdAt: now(),
      payload: payload == null ? this.capture() : payload
    };
    localStorage.setItem(key(this.namespace, 'snapshot:' + snap.id), JSON.stringify(snap));
    this.index.unshift({ id: snap.id, title: snap.title, app: snap.app, kind: snap.kind, createdAt: snap.createdAt });
    this.gc();
    this.saveIndex();
    localStorage.setItem(key(this.namespace, 'last'), snap.id);
    this.emit('snapshot', snap);
    return snap;
  };

  StorageManager.prototype.get = function (snapId) {
    try { return JSON.parse(localStorage.getItem(key(this.namespace, 'snapshot:' + snapId)) || 'null'); }
    catch (_) { return null; }
  };

  StorageManager.prototype.last = function () {
    var lastId = localStorage.getItem(key(this.namespace, 'last')) || (this.index[0] && this.index[0].id);
    return lastId ? this.get(lastId) : null;
  };

  StorageManager.prototype.restore = function (snapId) {
    var snap = snapId ? this.get(snapId) : this.last();
    if (!snap) return null;
    this.apply(snap.payload, snap);
    this.emit('restore', snap);
    return snap;
  };

  StorageManager.prototype.startAutosave = function () {
    var self = this;
    if (this.timer) return;
    this.timer = setInterval(function () {
      self.snapshot({ title: 'Autosave ' + new Date().toLocaleTimeString(), kind: 'autosave', app: 'nexus-v9' });
    }, this.autosaveMs);
  };

  StorageManager.prototype.stopAutosave = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  StorageManager.prototype.gc = function () {
    while (this.index.length > this.maxSnapshots) {
      var old = this.index.pop();
      if (old) localStorage.removeItem(key(this.namespace, 'snapshot:' + old.id));
    }
  };

  StorageManager.prototype.exportJson = function () {
    var payload = { namespace: this.namespace, exportedAt: now(), index: clone(this.index), snapshots: [] };
    for (var i = 0; i < this.index.length; i++) {
      var s = this.get(this.index[i].id);
      if (s) payload.snapshots.push(s);
    }
    return JSON.stringify(payload, null, 2);
  };

  StorageManager.prototype.importJson = function (text) {
    var parsed = JSON.parse(text);
    var snaps = parsed.snapshots || [];
    for (var i = 0; i < snaps.length; i++) {
      var snap = snaps[i];
      localStorage.setItem(key(this.namespace, 'snapshot:' + snap.id), JSON.stringify(snap));
      if (!this.index.some(function (x) { return x.id === snap.id; })) {
        this.index.unshift({ id: snap.id, title: snap.title, app: snap.app, kind: snap.kind, createdAt: snap.createdAt });
      }
    }
    this.gc();
    this.saveIndex();
    this.emit('import', this.index);
  };

  global.PeernetStorageManager = StorageManager;
})(window);
