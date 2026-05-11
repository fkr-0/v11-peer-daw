/* peernet-user-manager.js
 * Headless unified user/profile/presence/save-state manager for Peernet apps.
 * Additive: does not own transport; bindCore(core) adapts PeernetSharedCore or compatible APIs.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    profile: {
      id: '',
      username: 'pilot',
      color: '#00ffff',
      status: 'available',
      note: '',
      capabilities: ['chat', 'presence', 'save-states']
    },
    connection: {
      autoConnect: false,
      sharedLayer: false,
      allowIncomingSaveStates: true,
      announcePresence: true
    },
    saveStates: []
  };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function merge(a, b) {
    var out = clone(a);
    Object.keys(b || {}).forEach(function (k) {
      out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(out[k] || {}, b[k]) : b[k];
    });
    return out;
  }
  function newId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }

  function UserManager(opts) {
    opts = opts || {};
    this.storageKey = opts.storageKey || 'peernet-user-manager-v1';
    this.state = merge(DEFAULTS, this.load());
    if (!this.state.profile.id) this.state.profile.id = newId('user');
    this.presence = new Map();
    this.core = null;
    this.listeners = {};
    this.save();
  }

  UserManager.prototype.on = function (event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
    return this;
  };

  UserManager.prototype.emit = function (event, payload) {
    (this.listeners[event] || []).forEach(function (fn) { try { fn(payload); } catch (e) { console.warn('[PeernetUserManager]', e); } });
    (this.listeners['*'] || []).forEach(function (fn) { try { fn(event, payload); } catch (e) { console.warn('[PeernetUserManager]', e); } });
  };

  UserManager.prototype.load = function () {
    try { return JSON.parse(localStorage.getItem(this.storageKey) || '{}'); }
    catch (_) { return {}; }
  };

  UserManager.prototype.save = function () {
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    this.emit('change', this.snapshot());
  };

  UserManager.prototype.snapshot = function () {
    return {
      profile: clone(this.state.profile),
      connection: clone(this.state.connection),
      saveStates: clone(this.state.saveStates),
      peers: Array.from(this.presence.values())
    };
  };

  UserManager.prototype.setProfile = function (patch) {
    this.state.profile = merge(this.state.profile, patch || {});
    this.save();
    this.announcePresence();
    this.emit('profile', clone(this.state.profile));
  };

  UserManager.prototype.setConnection = function (patch) {
    this.state.connection = merge(this.state.connection, patch || {});
    this.save();
    this.emit('connection:settings', clone(this.state.connection));
  };

  UserManager.prototype.bindCore = function (core) {
    var self = this;
    this.core = core;
    if (!core || typeof core.on !== 'function') return this;
    core.on('open', function (payload) {
      self.setProfile({ peerId: payload.id });
      self.announcePresence();
    });
    core.on('identity', function (payload) { self.recordPresence(payload.id, payload); });
    core.on('peers', function (peers) { (peers || []).forEach(function (p) { self.recordPresence(p.id, p); }); });
    core.on('peer:leave', function (payload) { self.presence.delete(payload.id); self.emit('presence', self.snapshot().peers); });
    core.on('message:presence', function (payload) { self.recordPresence(payload.id, payload.data && payload.data.profile || payload.data); });
    core.on('message:save-state-offer', function (payload) { self.emit('save-state:offer', payload); });
    return this;
  };

  UserManager.prototype.recordPresence = function (id, data) {
    if (!id) return;
    var prev = this.presence.get(id) || {};
    var next = merge(prev, data || {});
    next.id = id;
    next.lastSeen = Date.now();
    this.presence.set(id, next);
    this.emit('presence', this.snapshot().peers);
  };

  UserManager.prototype.announcePresence = function () {
    if (!this.core || !this.state.connection.announcePresence) return;
    var msg = { type: 'presence', profile: clone(this.state.profile), at: Date.now() };
    if (typeof this.core.broadcast === 'function') this.core.broadcast(msg);
    if (typeof this.core.setIdentity === 'function') this.core.setIdentity({ username: this.state.profile.username, color: this.state.profile.color });
  };

  UserManager.prototype.createSaveState = function (meta, payload) {
    var item = merge({
      id: newId('save'),
      title: 'Untitled save',
      app: 'v9',
      ownerId: this.state.profile.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sharedWith: [],
      payload: null
    }, meta || {});
    item.payload = payload == null ? item.payload : payload;
    this.state.saveStates.unshift(item);
    this.save();
    this.emit('save-state:create', clone(item));
    return item;
  };

  UserManager.prototype.offerSaveState = function (peerId, saveId) {
    var save = this.state.saveStates.find(function (s) { return s.id === saveId; });
    if (!save || !this.core || typeof this.core.send !== 'function') return false;
    this.core.send(peerId, { type: 'save-state-offer', save: save, from: clone(this.state.profile), at: Date.now() });
    return true;
  };

  UserManager.prototype.acceptSaveState = function (offer) {
    if (!offer || !offer.save || !this.state.connection.allowIncomingSaveStates) return null;
    var save = merge(offer.save, { id: newId('save'), receivedFrom: offer.id || (offer.from && offer.from.id), receivedAt: Date.now() });
    this.state.saveStates.unshift(save);
    this.save();
    this.emit('save-state:accept', clone(save));
    return save;
  };

  global.PeernetUserManager = UserManager;
})(window);
