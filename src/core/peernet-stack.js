// PeerModGroove/src/core/peernet-stack.js
// Adapter for the 4-layer Peernet architecture loaded from vendor/peernet/*.js.

export class PeernetStack extends EventTarget {
  constructor({ namespace = 'peermodgroove', capture = () => ({}), apply = () => {} } = {}) {
    super();
    this.namespace = namespace;
    this.capture = capture;
    this.apply = apply;
    this.core = null;
    this.user = null;
    this.sessions = null;
    this.storage = null;
    this.started = false;
  }

  available() {
    return Boolean(
      window.PeernetUserManager &&
        window.PeernetSharedCore &&
        window.PeernetSessionManager &&
        window.PeernetStorageManager
    );
  }

  init(profile = {}) {
    if (!this.available()) {
      this.emit('status', { text: 'Peernet 4-layer stack unavailable', connected: false });
      return false;
    }

    this.core =
      this.core ||
      new window.PeernetSharedCore({
        namespace: this.namespace,
        hubId: `${this.namespace}-hub-01`,
        username: profile.username || 'pilot',
        color: profile.color || '#00ffff',
        debug: false,
      });

    this.user =
      this.user || new window.PeernetUserManager({ storageKey: `${this.namespace}:identity` });
    this.user.bindCore(this.core);
    this.user.setProfile({
      username: profile.username || this.user.snapshot().profile.username || 'pilot',
      color: profile.color || this.user.snapshot().profile.color || '#00ffff',
      capabilities: ['presence', 'patch', 'midi-control', 'audio-rig', 'sessions', 'storage'],
    });

    this.sessions =
      this.sessions ||
      new window.PeernetSessionManager({
        storageKey: `${this.namespace}:sessions`,
        userManager: this.user,
        core: this.core,
      });
    this.sessions.bind({ userManager: this.user, core: this.core });

    this.storage =
      this.storage ||
      new window.PeernetStorageManager({
        namespace: `${this.namespace}:storage`,
        maxSnapshots: 40,
        autosaveMs: 20000,
        capture: this.capture,
        apply: this.apply,
      });

    this.bindEvents();
    return true;
  }

  bindEvents() {
    if (this._bound) return;
    this._bound = true;
    this.core?.on('open', (payload) =>
      this.emit('status', { text: `open:${payload.id}`, connected: true })
    );
    this.core?.on('hub:join', (payload) =>
      this.emit('status', { text: `in session hub:${payload.id}`, connected: true })
    );
    this.core?.on('hub:ready', (payload) =>
      this.emit('status', { text: `hosting:${payload.id}`, connected: true })
    );
    this.core?.on('error', (payload) =>
      this.emit('status', {
        text: `peer warning:${payload?.type || payload?.message || 'unavailable'}`,
        connected: false,
        warning: true,
      })
    );
    this.core?.on('peers', (peers) => this.emit('peers', peers || []));
    this.core?.on('message:pmg-packet', (payload) => this.emit('packet', payload?.data || payload));
    this.core?.on('message:pmg-patch', (payload) => this.emit('patch', payload?.data || payload));
    this.user?.on('presence', (peers) => this.emit('presence', peers || []));
    this.sessions?.on('change', (snapshot) => this.emit('sessions', snapshot));
    this.storage?.on('snapshot', (snapshot) => this.emit('storage', snapshot));
  }

  start(profile = {}) {
    if (!this.init(profile)) return false;
    if (!this.started) {
      this.core.start();
      this.storage.startAutosave();
      this.started = true;
    }
    return true;
  }

  broadcastPacket(packet, inputId = 'control') {
    this.core?.broadcast({ type: 'pmg-packet', inputId, packet, at: Date.now() });
  }

  broadcastPatch(patch) {
    this.core?.broadcast({ type: 'pmg-patch', patch, at: Date.now() });
  }

  broadcast(type, data = {}) {
    this.core?.broadcast({ type: `artifact:${type}`, data, at: Date.now() });
  }

  onMessage(type, handler) {
    this.core?.on?.(`message:artifact:${type}`, (payload) => handler(payload?.data || payload));
    return this;
  }

  joinLobby(lobbyId) {
    // SharedCore uses namespace/hubId at construction time. This compatibility hook
    // allows shared editor adapters to request a logical room without owning transport.
    this.emit('status', { text: `logical room:${lobbyId}`, connected: Boolean(this.started) });
    return this;
  }

  createSession(title = 'PeerModGroove Session') {
    return this.sessions?.createSession({ title, app: 'PeerModGroove' }, this.capture());
  }

  ensureSharedSession({
    id = `${this.namespace}:default-session`,
    code = 'V11-OPEN-STUDIO',
    title = 'V11 Open Studio Session',
  } = {}) {
    if (!this.sessions) return null;
    const existing = this.sessions.sessions.find((session) => session.id === id);
    if (existing) {
      this.sessions.joinSession(existing);
      return this.sessions.getActiveSession();
    }
    const session = this.sessions.createSession({ title, app: 'V11 Peer DAW' }, this.capture());
    session.id = id;
    session.code = code;
    session.title = title;
    session.mode = 'open-collab';
    session.updatedAt = Date.now();
    this.sessions.activeSessionId = id;
    this.sessions.save();
    this.sessions.announceUpdate(session);
    return session;
  }

  snapshot(title = 'Manual PeerModGroove Snapshot') {
    return this.storage?.snapshot({ title, app: 'PeerModGroove', kind: 'manual' });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
