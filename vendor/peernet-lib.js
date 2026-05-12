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
  }

  // ── public API ────────────────────────────────────────────────

  /** Connect to (or become) the lobby hub.
   *  @param {string} username
   *  @returns {Promise<string>} resolved when connected, with our peer ID
   */
  connect(username) {
    this._username = username || this._loadUsername() || ('User-' + Math.floor(Math.random() * 9999));
    return new Promise((resolve) => {
      this._initPeer(resolve);
    });
  }

  /** Broadcast a data object to all directly-connected peers. */
  broadcast(data) {
    this._peers.forEach(entry => {
      if (entry.conn && entry.conn.open) entry.conn.send(data);
    });
  }

  /** Send a data object to a specific peer by ID. */
  send(peerId, data) {
    const entry = this._peers.get(peerId);
    if (entry && entry.conn && entry.conn.open) entry.conn.send(data);
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

  destroy() {
    this._destroyed = true;
    if (this._peer && !this._peer.destroyed) this._peer.destroy();
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
    this._emit('status', { connected, text });
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
      this._emitStatus(!!this._peer && !this._peer.disconnected, this._isHub ? 'Hub' : 'In Lobby');
    });
    conn.on('error', err => this._log('conn error', conn.peer, err.type));
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
    const conn = this._peer.connect(this.lobbyId, { reliable: true });
    conn.on('open', () => {
      this._tryingHub = false;
      this._isHub = false;
      this._registerConn(conn, 'Hub');
      conn.send({ type: 'join', username: this._username });
      this._emitStatus(true, 'In Lobby');
      this._emitPeers();
      if (onConnected) onConnected(this._myId);
      // Reconnect if hub drops
      conn.on('close', () => {
        this._peers.delete(conn.peer);
        this._emitStatus(false, 'Hub gone');
        if (!this._destroyed) {
          setTimeout(() => this._rejoinOrBecomeHub(), 1000 + Math.random() * 1000);
        }
      });
    });
    // peer-unavailable → peer.on('error') → becomeHub
  }

  _rejoinOrBecomeHub() {
    if (this._destroyed || !this._peer || this._peer.destroyed) return;
    this._tryingHub = true;
    const conn = this._peer.connect(this.lobbyId, { reliable: true });
    conn.on('open', () => {
      this._tryingHub = false;
      this._registerConn(conn, 'Hub');
      conn.send({ type: 'join', username: this._username });
      this._emitStatus(true, 'In Lobby');
      this._emitPeers();
      conn.on('close', () => {
        this._peers.delete(conn.peer);
        if (!this._destroyed) setTimeout(() => this._rejoinOrBecomeHub(), 1000 + Math.random() * 1000);
      });
    });
    // peer-unavailable handled in peer.on('error')
  }

  _becomeHub(onConnected) {
    const old = this._peer;
    this._peer = null;
    this._peers.clear();
    if (old && !old.destroyed) old.destroy();

    const hubPeer = new Peer(this.lobbyId, Object.assign({ debug: 0 }, this.peerOpts));
    this._peer = hubPeer;

    hubPeer.on('open', id => {
      this._myId  = id;
      this._isHub = true;
      this._setupIncoming(hubPeer);
      this._emitStatus(true, 'Hub');
      this._emitPeers();
      if (onConnected) onConnected(id);
    });

    hubPeer.on('error', err => {
      if (err.type === 'unavailable-id') {
        // Lost race — become client
        setTimeout(() => {
          if (this._destroyed) return;
          const p = new Peer(Object.assign({ debug: 0 }, this.peerOpts));
          this._peer   = p;
          this._isHub  = false;
          p.on('open', id => { this._myId = id; this._setupIncoming(p); this._tryJoinHub(onConnected); });
          p.on('error', e => this._emitStatus(false, e.type));
        }, 500 + Math.random() * 500);
      } else {
        this._emitStatus(false, err.type || 'Error');
      }
    });
  }

  _initPeer(onConnected) {
    const peer = new Peer(Object.assign({ debug: 0 }, this.peerOpts));
    this._peer = peer;

    peer.on('open', id => {
      this._myId = id;
      this._log('open', id);
      this._setupIncoming(peer);
      this._emitStatus(true, 'Joining...');
      this._tryJoinHub(onConnected);
    });

    peer.on('error', err => {
      if (err.type === 'peer-unavailable' && this._tryingHub) {
        this._tryingHub = false;
        this._becomeHub(onConnected);
      } else {
        this._log('peer error', err.type);
        if (err.type !== 'peer-unavailable') this._emitStatus(false, err.type);
      }
    });
  }
}
