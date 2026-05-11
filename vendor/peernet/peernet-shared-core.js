/* peernet-shared-core.js
 * Additive shared P2P helper for Nexus v9 / Peernet apps.
 * Does not replace existing app-specific PeerJS flows; apps opt in by creating a PeernetSharedCore instance.
 */
(function (global) {
  'use strict';

  function idSuffix() { return Math.random().toString(36).slice(2, 8); }
  function now() { return Date.now(); }

  function safeCall(fn) {
    if (typeof fn !== 'function') return;
    try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
    catch (err) { console.warn('[PeernetSharedCore listener]', err); }
  }

  function PeernetSharedCore(opts) {
    opts = opts || {};
    this.Peer = opts.Peer || global.Peer;
    this.namespace = opts.namespace || 'nexus-shared';
    this.hubId = opts.hubId || (this.namespace + '-hub-01');
    this.username = opts.username || ('User-' + idSuffix());
    this.color = opts.color || '#00ffff';
    this.peer = null;
    this.myId = null;
    this.isHub = false;
    this.tryingHub = false;
    this.connections = new Map();
    this.listeners = {};
    this.started = false;
    this.debug = !!opts.debug;
  }

  PeernetSharedCore.prototype.on = function (event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
    return this;
  };

  PeernetSharedCore.prototype.emit = function (event, payload) {
    (this.listeners[event] || []).forEach(function (fn) { safeCall(fn, payload); });
    (this.listeners['*'] || []).forEach(function (fn) { safeCall(fn, event, payload); });
  };

  PeernetSharedCore.prototype.log = function () {
    if (this.debug) console.log.apply(console, ['[PeernetSharedCore]'].concat(Array.prototype.slice.call(arguments)));
  };

  PeernetSharedCore.prototype.start = function () {
    var self = this;
    if (!this.Peer) {
      this.emit('error', { type: 'missing-peerjs', message: 'PeerJS global not found' });
      return;
    }
    if (this.started) return;
    this.started = true;
    this.peer = new this.Peer({ debug: 0 });
    this.peer.on('open', function (id) {
      self.myId = id;
      self.emit('open', { id: id, username: self.username });
      self.setupIncoming(self.peer);
      self.joinHub();
    });
    this.peer.on('error', function (err) {
      if (err && err.type === 'peer-unavailable' && self.tryingHub) self.becomeHub();
      else self.emit('error', err || { type: 'unknown' });
    });
  };

  PeernetSharedCore.prototype.stop = function () {
    this.connections.forEach(function (entry) { try { entry.conn.close(); } catch (_) {} });
    this.connections.clear();
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peer = null;
    this.myId = null;
    this.started = false;
    this.emit('close', {});
  };

  PeernetSharedCore.prototype.setIdentity = function (identity) {
    identity = identity || {};
    if (identity.username) this.username = identity.username;
    if (identity.color) this.color = identity.color;
    this.broadcast({ type: 'identity', username: this.username, color: this.color });
    this.emit('identity', { id: this.myId, username: this.username, color: this.color, local: true });
  };

  PeernetSharedCore.prototype.registerConn = function (conn, meta) {
    var self = this;
    if (!conn || !conn.peer) return null;
    var entry = this.connections.get(conn.peer) || {
      id: conn.peer,
      username: (meta && meta.username) || 'Guest',
      color: (meta && meta.color) || '#888',
      conn: conn,
      openedAt: now()
    };
    entry.conn = conn;
    if (meta && meta.username) entry.username = meta.username;
    if (meta && meta.color) entry.color = meta.color;
    this.connections.set(conn.peer, entry);

    conn.on('data', function (data) { self.handleData(conn.peer, data || {}); });
    conn.on('close', function () {
      self.connections.delete(conn.peer);
      if (self.isHub) self.broadcast({ type: 'peer-left', id: conn.peer }, conn.peer);
      self.emit('peer:leave', { id: conn.peer, entry: entry });
      self.emit('peers', self.peerList());
    });
    conn.on('error', function (err) { self.emit('connection:error', { id: conn.peer, error: err }); });
    return entry;
  };

  PeernetSharedCore.prototype.setupIncoming = function (peer) {
    var self = this;
    peer.on('connection', function (conn) {
      conn.on('open', function () {
        self.registerConn(conn, {});
        conn.send({ type: 'hello', username: self.username, color: self.color });
        self.emit('peer:connect', { id: conn.peer, entry: self.connections.get(conn.peer), incoming: true });
        self.emit('peers', self.peerList());
      });
    });
  };

  PeernetSharedCore.prototype.joinHub = function () {
    var self = this;
    if (!this.peer || this.peer.destroyed) return;
    this.tryingHub = true;
    var conn = this.peer.connect(this.hubId, { reliable: true });
    conn.on('open', function () {
      self.tryingHub = false;
      self.isHub = false;
      self.registerConn(conn, { username: 'Lobby Hub', color: '#666' });
      conn.send({ type: 'join', username: self.username, color: self.color });
      self.emit('hub:join', { id: self.hubId });
    });
  };

  PeernetSharedCore.prototype.becomeHub = function () {
    var self = this;
    this.tryingHub = false;
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peer = new this.Peer(this.hubId, { debug: 0 });
    this.peer.on('open', function (id) {
      self.myId = id;
      self.isHub = true;
      self.setupIncoming(self.peer);
      self.emit('hub:ready', { id: id });
    });
    this.peer.on('error', function (err) { self.emit('error', err); });
  };

  PeernetSharedCore.prototype.connectPeer = function (peerId, meta) {
    var self = this;
    if (!peerId || peerId === this.myId || this.connections.has(peerId) || !this.peer) return;
    var conn = this.peer.connect(peerId, { reliable: true });
    conn.on('open', function () {
      self.registerConn(conn, meta || {});
      conn.send({ type: 'hello', username: self.username, color: self.color });
      self.emit('peer:connect', { id: peerId, entry: self.connections.get(peerId), incoming: false });
      self.emit('peers', self.peerList());
    });
  };

  PeernetSharedCore.prototype.handleData = function (peerId, data) {
    var entry = this.connections.get(peerId);
    if (!entry) return;
    switch (data.type) {
      case 'join': {
        if (!this.isHub) return;
        entry.username = data.username || entry.username;
        entry.color = data.color || entry.color;
        var peers = [];
        this.connections.forEach(function (e, id) {
          if (id !== peerId) peers.push({ id: id, username: e.username, color: e.color });
        });
        entry.conn.send({ type: 'peer-list', peers: peers });
        this.broadcast({ type: 'new-peer', id: peerId, username: entry.username, color: entry.color }, peerId);
        this.emit('peer:join', { id: peerId, entry: entry });
        this.emit('peers', this.peerList());
        break;
      }
      case 'peer-list':
        (data.peers || []).forEach(this.connectPeer.bind(this));
        break;
      case 'new-peer':
        this.connectPeer(data.id, data);
        this.emit('peer:join', { id: data.id, entry: data });
        break;
      case 'peer-left':
        this.connections.delete(data.id);
        this.emit('peer:leave', { id: data.id });
        this.emit('peers', this.peerList());
        break;
      case 'hello':
      case 'identity':
        entry.username = data.username || entry.username;
        entry.color = data.color || entry.color;
        this.emit('identity', { id: peerId, username: entry.username, color: entry.color });
        this.emit('peers', this.peerList());
        break;
      default:
        this.emit('message', { id: peerId, data: data, entry: entry });
        this.emit('message:' + data.type, { id: peerId, data: data, entry: entry });
        break;
    }
  };

  PeernetSharedCore.prototype.broadcast = function (msg, excludeId) {
    this.connections.forEach(function (entry, id) {
      if (id !== excludeId && entry.conn && entry.conn.open) entry.conn.send(msg);
    });
  };

  PeernetSharedCore.prototype.send = function (peerId, msg) {
    var entry = this.connections.get(peerId);
    if (entry && entry.conn && entry.conn.open) entry.conn.send(msg);
  };

  PeernetSharedCore.prototype.peerList = function () {
    var out = [];
    this.connections.forEach(function (entry, id) {
      out.push({ id: id, username: entry.username, color: entry.color, isHub: id.indexOf('-hub-') !== -1 });
    });
    return out;
  };

  global.PeernetSharedCore = PeernetSharedCore;
})(window);
