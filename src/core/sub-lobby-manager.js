// V11 Peer DAW/src/core/sub-lobby-manager.js
// App-hub-visible multiplayer sub-lobby coordination for shared DAW projects.

export const APP_HUB_LOBBY_ID = 'nexus-v11-hub-main';
export const SUB_LOBBY_PREFIX = 'v11-peer-daw-sublobby';

export const SUB_LOBBY_PACKET_TYPES = Object.freeze({
  offer: 'v11-daw:sublobby-offer',
  projectUpdate: 'v11-daw:project-update',
  userIntent: 'v11-daw:user-intent',
});

function createEmitter() {
  const listeners = new Map();
  return {
    on(type, fn) {
      listeners.set(type, [...(listeners.get(type) || []), fn]);
      return () => listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn));
    },
    emit(type, payload) {
      for (const fn of listeners.get(type) || []) fn(payload);
    },
  };
}

function normalizePeers(input) {
  if (!input) return new Map();
  if (input instanceof Map) return new Map(input);
  if (Array.isArray(input)) return new Map(input);
  if (typeof input === 'object') return new Map(Object.entries(input));
  return new Map();
}

function safeProjectSnapshot(projectProvider) {
  try {
    return projectProvider?.() || null;
  } catch (_error) {
    return null;
  }
}

export class SubLobbyManager {
  constructor({
    username = 'pilot',
    lobbyFactory,
    appHubLobbyId = APP_HUB_LOBBY_ID,
    subLobbyPrefix = SUB_LOBBY_PREFIX,
    storageKey = 'v11-peer-daw',
    now = () => Date.now(),
    randomId = () => Math.random().toString(36).slice(2, 10),
    projectProvider = () => null,
    projectConsumer = () => {},
    autoCreateWhenAlone = false,
    autoJoinOffers = true,
    blockIncoming = false,
  } = {}) {
    this.username = username;
    this.lobbyFactory = lobbyFactory;
    this.appHubLobbyId = appHubLobbyId;
    this.subLobbyPrefix = subLobbyPrefix;
    this.storageKey = storageKey;
    this.now = now;
    this.randomId = randomId;
    this.projectProvider = projectProvider;
    this.projectConsumer = projectConsumer;
    this.autoCreateWhenAlone = autoCreateWhenAlone;
    this.autoJoinOffers = autoJoinOffers;
    this.blockIncoming = blockIncoming;

    this.appHubLobby = null;
    this.subLobby = null;
    this.knownOffers = new Map();
    this.emitter = createEmitter();
    this.state = {
      appHubConnected: false,
      appHubPeerId: '',
      subLobbyId: '',
      role: 'offline',
      peers: new Map(),
      subLobbyPeers: new Map(),
      joinBlocked: blockIncoming,
      lastDecision: 'idle',
      projectVersion: 0,
    };
  }

  on(type, handler) {
    return this.emitter.on(type, handler);
  }

  setUsername(username) {
    this.username = username || this.username;
    this.appHubLobby?.setUsername?.(this.visibleUsername());
    this.subLobby?.setUsername?.(this.visibleUsername());
    this.emitState();
  }

  setBlockIncoming(blockIncoming) {
    this.blockIncoming = Boolean(blockIncoming);
    this.state.joinBlocked = this.blockIncoming;
    this.advertiseCurrentSubLobby();
    this.emitState();
  }

  visibleUsername() {
    return `${this.username || 'pilot'} · V11 DAW`;
  }

  async connect() {
    if (!this.lobbyFactory) {
      throw new Error('SubLobbyManager requires a lobbyFactory');
    }
    this.appHubLobby = this.lobbyFactory(this.appHubLobbyId, {
      storageKey: `${this.storageKey}:app-hub`,
    });
    this.bindAppHubLobby(this.appHubLobby);
    const id = await this.appHubLobby.connect(this.visibleUsername());
    this.state.appHubPeerId = id || this.appHubLobby.myId || '';
    this.state.appHubConnected = true;
    this.state.role = this.state.role === 'offline' ? 'hub-visible' : this.state.role;
    this.emitState();
    if (this.autoCreateWhenAlone && normalizePeers(this.appHubLobby.peers).size === 0) {
      await this.createHostedSubLobby({ carryCurrentProject: true });
    }
    return this.state;
  }

  bindAppHubLobby(lobby) {
    lobby.addEventListener?.('status', (event) => {
      this.state.appHubConnected = Boolean(event.detail?.connected);
      this.emitState();
    });
    lobby.addEventListener?.('peers', (event) => {
      this.state.peers = normalizePeers(event.detail);
      if (this.autoCreateWhenAlone && this.state.role === 'hub-visible' && this.state.peers.size === 0) {
        this.createHostedSubLobby({ carryCurrentProject: true });
      }
      if (this.state.role === 'host' && this.state.subLobbyId && this.state.peers.size > 0) {
        this.advertiseCurrentSubLobby({ carryCurrentProject: true });
      }
      this.emitState();
    });
    lobby.addEventListener?.('data', (event) => {
      this.handleAppHubData(event.detail || {});
    });
  }

  async handleAppHubData({ from = '', data = {} }) {
    if (data?.type !== SUB_LOBBY_PACKET_TYPES.offer) return;
    const offer = { ...(data.payload || {}), from };
    if (!offer.subLobbyId) return;
    this.knownOffers.set(offer.subLobbyId, offer);
    this.emitter.emit('offer', offer);

    if (!this.autoJoinOffers || this.state.subLobbyId) return;
    if (offer.joinBlocked) {
      this.state.lastDecision = 'blocked-spawned-own';
      await this.createHostedSubLobby({ carryCurrentProject: true });
      return;
    }
    await this.joinSubLobby(offer);
  }

  async createHostedSubLobby({ carryCurrentProject = true, subLobbyId = '' } = {}) {
    const nextId = subLobbyId || `${this.subLobbyPrefix}-${this.randomId()}`;
    await this.replaceSubLobby(nextId, 'host');
    this.state.lastDecision = carryCurrentProject ? 'hosted-with-current-project' : 'hosted-new-project';
    this.advertiseCurrentSubLobby({ carryCurrentProject });
    return this.state;
  }

  async joinSubLobby(offerOrId) {
    const offer = typeof offerOrId === 'string' ? { subLobbyId: offerOrId } : offerOrId || {};
    if (!offer.subLobbyId) return this.state;
    await this.replaceSubLobby(offer.subLobbyId, 'guest');
    this.state.lastDecision = 'joined-offer';
    if (offer.projectSnapshot) {
      this.projectConsumer(offer.projectSnapshot);
      this.state.projectVersion += 1;
    }
    return this.state;
  }

  async replaceSubLobby(subLobbyId, role) {
    this.subLobby?.destroy?.();
    this.subLobby = this.lobbyFactory(subLobbyId, {
      storageKey: `${this.storageKey}:${subLobbyId}`,
    });
    this.bindSubLobby(this.subLobby);
    this.state.subLobbyId = subLobbyId;
    this.state.role = role;
    this.state.subLobbyPeers = new Map();
    await this.subLobby.connect(this.visibleUsername());
    this.emitState();
  }

  bindSubLobby(lobby) {
    lobby.addEventListener?.('peers', (event) => {
      this.state.subLobbyPeers = normalizePeers(event.detail);
      this.emitState();
    });
    lobby.addEventListener?.('data', (event) => this.handleSubLobbyData(event.detail || {}));
  }

  advertiseCurrentSubLobby({ carryCurrentProject = true } = {}) {
    if (!this.appHubLobby || !this.state.subLobbyId) return;
    const projectSnapshot = carryCurrentProject ? safeProjectSnapshot(this.projectProvider) : null;
    this.appHubLobby.broadcast({
      type: SUB_LOBBY_PACKET_TYPES.offer,
      payload: {
        subLobbyId: this.state.subLobbyId,
        hostId: this.state.appHubPeerId || this.appHubLobby.myId || '',
        hostName: this.username || 'pilot',
        role: this.state.role,
        joinBlocked: this.blockIncoming,
        hasProjectSnapshot: Boolean(projectSnapshot),
        projectSnapshot,
        at: this.now(),
      },
    });
  }

  publishProjectChange(project = safeProjectSnapshot(this.projectProvider), reason = 'local-change') {
    if (!this.subLobby || !this.state.subLobbyId || !project) return false;
    this.subLobby.broadcast({
      type: SUB_LOBBY_PACKET_TYPES.projectUpdate,
      payload: {
        project,
        reason,
        fromRole: this.state.role,
      },
    });
    this.state.projectVersion += 1;
    this.emitState();
    return true;
  }

  handleSubLobbyData({ from = '', data = {} }) {
    this.emitter.emit('data', { from, data });
    if (data?.type !== SUB_LOBBY_PACKET_TYPES.projectUpdate) return;
    const project = data.payload?.project;
    if (!project) return;
    this.projectConsumer(project);
    this.state.projectVersion += 1;
    this.emitter.emit('project', { project, reason: data.payload?.reason || 'remote-change' });
    this.emitState();
  }

  snapshot() {
    return {
      ...this.state,
      peers: new Map(this.state.peers),
      subLobbyPeers: new Map(this.state.subLobbyPeers),
      offers: [...this.knownOffers.values()],
    };
  }

  emitState() {
    this.emitter.emit('state', this.snapshot());
  }

  destroy() {
    this.subLobby?.destroy?.();
    this.appHubLobby?.destroy?.();
  }
}
