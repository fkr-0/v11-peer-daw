/**
 * peernet-lib.js — Reusable PeerJS hub-and-mesh lobby
 *
 * Usage:
 *   import { PeernetLobby } from './peernet-lib.js';
 *
 *   const lobby = new PeernetLobby('my-app-hub-01', { debug: false });
 *
 *   lobby.on('status', ({ connected, text }) => { ... });
 *   lobby.on('peers',  (peers) => { ... });   // Map<id, {username, color, conn}>
 *   lobby.on('data',   ({ from, data }) => { ... });
 *
 *   await lobby.connect('MyUsername');
 *   lobby.broadcast({ type: 'chat', text: 'hello' });
 *   lobby.send(peerId, { type: 'ping' });
 *   lobby.setUsername('NewName');
 *   lobby.destroy();
 *
 * Built-in localStorage keys (optional, pass storageKey to enable):
 *   <storageKey>-username
 */

export const PeernetConnectionState = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  JOINING: 'joining',
  CONNECTED: 'connected',
  HOSTING: 'hosting',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline',
  DESTROYED: 'destroyed',
});

export class PeernetLobby extends EventTarget {
  /**
   * @param {string} lobbyId   - Well-known fixed peer ID for the hub.
   *                             Change to reset the lobby (all peers get fresh start).
   * @param {object} opts
   * @param {boolean} [opts.debug=false]
   * @param {string}  [opts.storageKey]  - localStorage prefix for persisting username
   * @param {string}  [opts.peerServer]  - custom PeerJS server host (optional)
   * @param {number}  [opts.peerPort]    - custom PeerJS server port (optional)
   */
  constructor(lobbyId, opts = {}) {
    super();
    this.lobbyId     = lobbyId;
    this.debug       = opts.debug || false;
    this.storageKey  = opts.storageKey || null;
    this.PeerClass   = opts.Peer || globalThis.Peer || null;
    this.peerOpts    = opts.peerServer
      ? { host: opts.peerServer, port: opts.peerPort || 443, path: opts.peerPath || '/', secure: true }
      : {};

    this._peer       = null;
    this._myId       = null;
    this._isHub      = false;
    this._tryingHub  = false;
    this._username   = '';
    this._peers      = new Map();   // id → { username, color, conn }
    this._destroyed  = false;
    this._state      = PeernetConnectionState.IDLE;
    this._lastError  = null;
    this._lastTransitionAt = Date.now();
    this._reconnectAttempts = 0;
    this._timers     = new Set();
    this._connectPromise = null;
  }

  // ── public API ────────────────────────────────────────────────

  /** Connect to (or become) the lobby hub.
   *  @param {string} username
   *  @returns {Promise<string>} resolved when connected, with our peer ID
   */
  connect(username) {
    this._username = username || this._loadUsername() || ('User-' + Math.floor(Math.random() * 9999));
    if (this._destroyed) this._destroyed = false;
    if (this._myId && this.connected) return Promise.resolve(this._myId);
    if (this._connectPromise) return this._connectPromise;
    if (!this.PeerClass) {
      const error = new Error('PeerJS is unavailable');
      this._transition(PeernetConnectionState.OFFLINE, {
        connected: false,
        text: 'PeerJS unavailable',
        error,
      });
      return Promise.reject(error);
    }
    this._transition(PeernetConnectionState.CONNECTING, {
      connected: false,
      text: 'Connecting',
    });
    this._connectPromise = new Promise((resolve, reject) => {
      try {
        this._initPeer((id) => {
          this._connectPromise = null;
          resolve(id);
        });
      } catch (error) {
        this._connectPromise = null;
        this._transition(PeernetConnectionState.OFFLINE, {
          connected: false,
          text: error.message || 'Connection failed',
          error,
        });
        reject(error);
      }
    });
    return this._connectPromise;
  }

  /** Broadcast a data object to all directly-connected peers. */
  broadcast(data) {
    let delivered = 0;
    this._peers.forEach(entry => {
      if (entry.conn && entry.conn.open) {
        entry.conn.send(data);
        delivered += 1;
      }
    });
    return delivered;
  }

  /** Send a data object to a specific peer by ID. */
  send(peerId, data) {
    const entry = this._peers.get(peerId);
    if (entry && entry.conn && entry.conn.open) {
      entry.conn.send(data);
      return true;
    }
    return false;
  }

  /** Update username and broadcast to all peers. */
  setUsername(name) {
    this._username = name;
    if (this.storageKey) localStorage.setItem(this.storageKey + '-username', name);
    this.broadcast({ type: 'username', username: name });
    this._emitPeers();
  }

  get myId()    { return this._myId; }
  get isHub()   { return this._isHub; }
  get username(){ return this._username; }
  get peers()   { return this._peers; }
  get state()   { return this._state; }
  get connected() {
    return [PeernetConnectionState.CONNECTED, PeernetConnectionState.HOSTING].includes(this._state);
  }
  get health() {
    return Object.freeze({
      state: this._state,
      connected: this.connected,
      role: this._isHub ? 'hub' : this.connected ? 'client' : 'offline',
      lobbyId: this.lobbyId,
      myId: this._myId,
      peerCount: this._peers.size,
      reconnectAttempts: this._reconnectAttempts,
      lastError: this._lastError
        ? String(this._lastError.type || this._lastError.message || this._lastError)
        : null,
      changedAt: this._lastTransitionAt,
    });
  }

  destroy() {
    this._destroyed = true;
    this._clearTimers();
    this._peers.forEach(({ conn }) => {
      try { conn?.close?.(); } catch (_) {}
    });
    this._peers.clear();
    const oldPeer = this._peer;
    this._peer = null;
    if (oldPeer && !oldPeer.destroyed) oldPeer.destroy();
    this._myId = null;
    this._isHub = false;
    this._tryingHub = false;
    this._connectPromise = null;
    this._transition(PeernetConnectionState.DESTROYED, {
      connected: false,
      text: 'Disconnected',
    });
  }

  reconnect() {
    if (!this.PeerClass) return Promise.reject(new Error('PeerJS is unavailable'));
    this._destroyed = false;
    this._clearTimers();
    this._peers.forEach(({ conn }) => {
      try { conn?.close?.(); } catch (_) {}
    });
    this._peers.clear();
    if (this._peer && !this._peer.destroyed) this._peer.destroy();
    this._peer = null;
    this._myId = null;
    this._isHub = false;
    this._tryingHub = false;
    this._connectPromise = null;
    this._reconnectAttempts += 1;
    this._transition(PeernetConnectionState.RECONNECTING, {
      connected: false,
      text: 'Reconnecting',
    });
    return this.connect(this._username);
  }

  // ── private ───────────────────────────────────────────────────

  _loadUsername() {
    return this.storageKey ? localStorage.getItem(this.storageKey + '-username') : null;
  }

  _log(...args) {
    if (this.debug) console.log('[PeernetLobby]', ...args);
  }

  _emit(event, detail) {
    this.dispatchEvent(new CustomEvent(event, { detail }));
  }

  _emitStatus(connected, text) {
    this._emit('status', { connected, text, state: this._state, health: this.health });
    this._emit('health', this.health);
  }

  _transition(state, { connected = false, text = state, error = null } = {}) {
    this._state = state;
    this._lastTransitionAt = Date.now();
    if (error) this._lastError = error;
    if (connected) this._lastError = null;
    this._emitStatus(connected, text);
  }

  _schedule(fn, delay) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (!this._destroyed) fn();
    }, delay);
    this._timers.add(timer);
    return timer;
  }

  _clearTimers() {
    this._timers.forEach((timer) => clearTimeout(timer));
    this._timers.clear();
  }

  _createPeer(id = null) {
    if (!this.PeerClass) throw new Error('PeerJS is unavailable');
    return id
      ? new this.PeerClass(id, Object.assign({ debug: 0 }, this.peerOpts))
      : new this.PeerClass(Object.assign({ debug: 0 }, this.peerOpts));
  }

  _emitPeers() {
    this._emit('peers', this._peers);
  }

  _color(id) {
    const palette = ['#ff6b6b','#51cf66','#339af0','#ffd43b','#cc5de8','#20c997','#fd7e14','#74c0fc'];
    let h = 0;
    for (let i = 0; i < id.length; i++) { h = ((h << 5) - h) + id.charCodeAt(i); h |= 0; }
    return palette[Math.abs(h) % palette.length];
  }

  _registerConn(conn, knownUsername) {
    const entry = { username: knownUsername || 'Guest', color: this._color(conn.peer), conn };
    this._peers.set(conn.peer, entry);

    conn.on('data', data => this._handleData(conn.peer, data));
    conn.on('close', () => {
      if (this._isHub) this._broadcastAll({ type: 'peer-left', id: conn.peer }, conn.peer);
      this._peers.delete(conn.peer);
      this._emitPeers();
      this._emitStatus(this.connected, this._isHub ? 'Hub' : this.connected ? 'In Lobby' : 'Offline');
    });
    conn.on('error', err => {
      this._lastError = err;
      this._log('conn error', conn.peer, err.type);
      this._emit('connection-error', { peerId: conn.peer, error: err, health: this.health });
      this._emit('health', this.health);
    });
    return entry;
  }

  _broadcastAll(msg, excludeId) {
    this._peers.forEach((entry, id) => {
      if (id !== excludeId && entry.conn.open) entry.conn.send(msg);
    });
  }

  _connectDirectly(peerId, username) {
    if (this._peers.has(peerId) || peerId === this._myId || this._destroyed) return;
    const conn = this._peer.connect(peerId, { reliable: true });
    conn.on('open', () => {
      this._registerConn(conn, username);
      conn.send({ type: 'hello', username: this._username });
      this._emitPeers();
    });
  }

  _handleData(peerId, data) {
    const entry = this._peers.get(peerId);
    if (!entry) return;

    switch (data.type) {
      case 'join':
        if (!this._isHub) return;
        entry.username = data.username || entry.username;
        const list = [];
        this._peers.forEach((e, id) => { if (id !== peerId) list.push({ id, username: e.username }); });
        entry.conn.send({ type: 'peer-list', peers: list });
        this._broadcastAll({ type: 'new-peer', id: peerId, username: entry.username }, peerId);
        this._emitPeers();
        break;

      case 'peer-list':
        (data.peers || []).forEach(p => this._connectDirectly(p.id, p.username));
        break;

      case 'new-peer':
        this._connectDirectly(data.id, data.username);
        break;

      case 'peer-left':
        this._peers.delete(data.id);
        this._emitPeers();
        break;

      case 'hello':
        entry.username = data.username || entry.username;
        this._emitPeers();
        break;

      case 'username':
        entry.username = data.username;
        this._emitPeers();
        break;

      default:
        // Forward arbitrary app data to the 'data' event
        this._emit('data', { from: peerId, data });
    }
  }

  _setupIncoming(peer) {
    peer.on('connection', conn => {
      conn.on('open', () => {
        this._registerConn(conn, 'Guest');
        this._emitPeers();
        if (!this._isHub) conn.send({ type: 'hello', username: this._username });
      });
    });
  }

  _tryJoinHub(onConnected) {
    this._tryingHub = true;
    this._transition(PeernetConnectionState.JOINING, {
      connected: false,
      text: 'Joining lobby',
    });
    const conn = this._peer.connect(this.lobbyId, { reliable: true });
    conn.on('open', () => {
      this._tryingHub = false;
      this._isHub = false;
      this._reconnectAttempts = 0;
      this._registerConn(conn, 'Hub');
      conn.send({ type: 'join', username: this._username });
      this._transition(PeernetConnectionState.CONNECTED, { connected: true, text: 'In Lobby' });
      this._emitPeers();
      if (onConnected) onConnected(this._myId);
      // Reconnect if hub drops
      conn.on('close', () => {
        this._peers.delete(conn.peer);
        this._transition(PeernetConnectionState.RECONNECTING, {
          connected: false,
          text: 'Hub gone · reconnecting',
        });
        if (!this._destroyed) {
          this._schedule(() => this._rejoinOrBecomeHub(), 1000 + Math.random() * 1000);
        }
      });
    });
    // peer-unavailable → peer.on('error') → becomeHub
  }

  _rejoinOrBecomeHub() {
    if (this._destroyed || !this._peer || this._peer.destroyed) return;
    this._tryingHub = true;
    this._reconnectAttempts += 1;
    this._transition(PeernetConnectionState.RECONNECTING, {
      connected: false,
      text: `Reconnecting · attempt ${this._reconnectAttempts}`,
    });
    const conn = this._peer.connect(this.lobbyId, { reliable: true });
    conn.on('open', () => {
      this._tryingHub = false;
      this._isHub = false;
      this._reconnectAttempts = 0;
      this._registerConn(conn, 'Hub');
      conn.send({ type: 'join', username: this._username });
      this._transition(PeernetConnectionState.CONNECTED, { connected: true, text: 'In Lobby' });
      this._emitPeers();
      conn.on('close', () => {
        this._peers.delete(conn.peer);
        if (!this._destroyed) {
          this._schedule(() => this._rejoinOrBecomeHub(), 1000 + Math.random() * 1000);
        }
      });
    });
    // peer-unavailable handled in peer.on('error')
  }

  _becomeHub(onConnected) {
    const old = this._peer;
    this._peer = null;
    this._peers.clear();
    if (old && !old.destroyed) old.destroy();

    this._transition(PeernetConnectionState.CONNECTING, {
      connected: false,
      text: 'Claiming lobby hub',
    });
    const hubPeer = this._createPeer(this.lobbyId);
    this._peer = hubPeer;

    hubPeer.on('open', id => {
      this._myId  = id;
      this._isHub = true;
      this._reconnectAttempts = 0;
      this._setupIncoming(hubPeer);
      this._transition(PeernetConnectionState.HOSTING, { connected: true, text: 'Hub' });
      this._emitPeers();
      if (onConnected) onConnected(id);
    });

    hubPeer.on('error', err => {
      if (err.type === 'unavailable-id') {
        // Lost race — become client
        this._schedule(() => {
          if (this._destroyed) return;
          const p = this._createPeer();
          this._peer   = p;
          this._isHub  = false;
          p.on('open', id => { this._myId = id; this._setupIncoming(p); this._tryJoinHub(onConnected); });
          p.on('error', e =>
            this._transition(PeernetConnectionState.OFFLINE, {
              connected: false,
              text: e.type || 'Peer error',
              error: e,
            })
          );
        }, 500 + Math.random() * 500);
      } else {
        this._transition(PeernetConnectionState.OFFLINE, {
          connected: false,
          text: err.type || 'Error',
          error: err,
        });
      }
    });
  }

  _initPeer(onConnected) {
    const peer = this._createPeer();
    this._peer = peer;

    peer.on('open', id => {
      this._myId = id;
      this._log('open', id);
      this._setupIncoming(peer);
      this._transition(PeernetConnectionState.JOINING, {
        connected: false,
        text: 'Joining…',
      });
      this._tryJoinHub(onConnected);
    });

    peer.on('disconnected', () => {
      if (this._destroyed || this._peer !== peer) return;
      this._transition(PeernetConnectionState.RECONNECTING, {
        connected: false,
        text: 'Signalling disconnected',
      });
    });

    peer.on('close', () => {
      if (this._destroyed || this._peer !== peer) return;
      this._transition(PeernetConnectionState.OFFLINE, {
        connected: false,
        text: 'Peer closed',
      });
    });

    peer.on('error', err => {
      if (this._peer !== peer) return;
      if (err.type === 'peer-unavailable' && this._tryingHub) {
        this._tryingHub = false;
        this._becomeHub(onConnected);
      } else {
        this._log('peer error', err.type);
        if (err.type !== 'peer-unavailable') {
          this._transition(PeernetConnectionState.OFFLINE, {
            connected: false,
            text: err.type || 'Peer error',
            error: err,
          });
        }
      }
    });
  }
}
