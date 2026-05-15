// V11 Peer DAW/tests/unit/sub-lobby-manager.test.js
// Tests for DAW sub-lobby matchmaking and project sync.

import { describe, expect, test } from '@jest/globals';
import {
  APP_HUB_LOBBY_ID,
  SUB_LOBBY_PACKET_TYPES,
  SubLobbyManager,
} from '../../src/core/sub-lobby-manager.js';

class FakeLobby extends EventTarget {
  static instances = [];

  constructor(lobbyId, _opts = {}) {
    super();
    this.lobbyId = lobbyId;
    this.connectCalls = [];
    this.broadcasts = [];
    this.sent = [];
    this.username = '';
    this.destroyed = false;
    this._myId = `peer-${FakeLobby.instances.length + 1}`;
    this._isHub = false;
    this._peers = new Map();
    FakeLobby.instances.push(this);
  }

  connect(username) {
    this.username = username;
    this.connectCalls.push(username);
    this.dispatchEvent(
      new CustomEvent('status', { detail: { connected: true, text: 'In Lobby' } })
    );
    return Promise.resolve(this._myId);
  }

  broadcast(data) {
    this.broadcasts.push(data);
  }

  send(peerId, data) {
    this.sent.push({ peerId, data });
  }

  setUsername(username) {
    this.username = username;
  }

  destroy() {
    this.destroyed = true;
  }

  get myId() {
    return this._myId;
  }

  get isHub() {
    return this._isHub;
  }

  get peers() {
    return this._peers;
  }

  emitData(from, data) {
    this.dispatchEvent(new CustomEvent('data', { detail: { from, data } }));
  }

  emitPeers(peers) {
    this._peers = peers instanceof Map ? peers : new Map(peers);
    this.dispatchEvent(new CustomEvent('peers', { detail: this._peers }));
  }
}

async function waitFor(condition, description, timeoutMs = 1000) {
  const started = Date.now();
  while (true) {
    const result = condition();
    if (result) return result;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createManager(overrides = {}) {
  FakeLobby.instances = [];
  const manager = new SubLobbyManager({
    username: 'Ava',
    lobbyFactory: (lobbyId, opts) => new FakeLobby(lobbyId, opts),
    now: () => 1234,
    randomId: () => 'room-token',
    projectProvider: () => ({ version: 1, modules: [{ id: 'synth-1' }], routes: [] }),
    ...overrides,
  });
  return manager;
}

describe('SubLobbyManager', () => {
  test('connects to the app-hub lobby with a DAW-visible username', async () => {
    const manager = createManager();

    await manager.connect();

    expect(FakeLobby.instances[0].lobbyId).toBe(APP_HUB_LOBBY_ID);
    expect(FakeLobby.instances[0].connectCalls).toEqual(['Ava · V11 DAW']);
    expect(manager.state.appHubConnected).toBe(true);
  });

  test('first DAW user creates a hosted sub-lobby and advertises it on the hub', async () => {
    const manager = createManager();

    await manager.connect();
    await manager.createHostedSubLobby({ carryCurrentProject: true });

    const [mainLobby, subLobby] = FakeLobby.instances;
    expect(subLobby.lobbyId).toBe('v11-peer-daw-sublobby-room-token');
    expect(subLobby.connectCalls).toEqual(['Ava · V11 DAW']);
    expect(manager.state.role).toBe('host');
    expect(manager.state.subLobbyId).toBe('v11-peer-daw-sublobby-room-token');
    expect(mainLobby.broadcasts).toContainEqual({
      type: SUB_LOBBY_PACKET_TYPES.offer,
      payload: expect.objectContaining({
        subLobbyId: 'v11-peer-daw-sublobby-room-token',
        hostName: 'Ava',
        joinBlocked: false,
        hasProjectSnapshot: true,
      }),
    });
  });

  test('host re-advertises its sub-lobby when new hub peers appear', async () => {
    const manager = createManager();

    await manager.connect();
    await manager.createHostedSubLobby({ carryCurrentProject: true });
    FakeLobby.instances[0].broadcasts = [];

    FakeLobby.instances[0].emitPeers([['visitor-peer', { username: 'Visitor · V11 DAW' }]]);

    expect(FakeLobby.instances[0].broadcasts).toContainEqual({
      type: SUB_LOBBY_PACKET_TYPES.offer,
      payload: expect.objectContaining({
        subLobbyId: 'v11-peer-daw-sublobby-room-token',
        hostName: 'Ava',
      }),
    });
  });

  test('second DAW user joins the first advertised sub-lobby and applies its project snapshot', async () => {
    const applied = [];
    const manager = createManager({ projectConsumer: (project) => applied.push(project) });

    await manager.connect();
    FakeLobby.instances[0].emitData('host-peer', {
      type: SUB_LOBBY_PACKET_TYPES.offer,
      payload: {
        subLobbyId: 'shared-room',
        hostId: 'host-peer',
        hostName: 'Host',
        joinBlocked: false,
        projectSnapshot: { version: 1, modules: [{ id: 'remote-synth' }], routes: [] },
      },
    });

    await waitFor(() => applied.length === 1, 'remote project snapshot to apply');

    expect(FakeLobby.instances[1].lobbyId).toBe('shared-room');
    expect(manager.state.role).toBe('guest');
    expect(manager.state.subLobbyId).toBe('shared-room');
    expect(applied).toEqual([{ version: 1, modules: [{ id: 'remote-synth' }], routes: [] }]);
  });

  test('blocked auto-join offer makes the visitor spawn their own sub-lobby', async () => {
    const manager = createManager();

    await manager.connect();
    FakeLobby.instances[0].emitData('host-peer', {
      type: SUB_LOBBY_PACKET_TYPES.offer,
      payload: {
        subLobbyId: 'blocked-room',
        hostId: 'host-peer',
        hostName: 'Host',
        joinBlocked: true,
      },
    });

    expect(FakeLobby.instances[1].lobbyId).toBe('v11-peer-daw-sublobby-room-token');
    expect(manager.state.role).toBe('host');
    expect(manager.state.subLobbyId).toBe('v11-peer-daw-sublobby-room-token');
    expect(manager.state.lastDecision).toBe('blocked-spawned-own');
  });

  test('manual carry-over sub-lobby advertises the current project snapshot', async () => {
    const manager = createManager({
      projectProvider: () => ({ version: 7, modules: [{ id: 'carried' }], routes: [] }),
    });

    await manager.connect();
    await manager.createHostedSubLobby({ carryCurrentProject: true });

    const offer = FakeLobby.instances[0].broadcasts.find(
      (packet) => packet.type === SUB_LOBBY_PACKET_TYPES.offer
    );
    expect(offer.payload.projectSnapshot).toEqual({
      version: 7,
      modules: [{ id: 'carried' }],
      routes: [],
    });
  });

  test('publishes local project changes and consumes remote project updates in a sub-lobby', async () => {
    const applied = [];
    const manager = createManager({ projectConsumer: (project) => applied.push(project) });

    await manager.connect();
    await manager.createHostedSubLobby({ carryCurrentProject: true });
    manager.publishProjectChange({ version: 2, modules: [{ id: 'local-change' }], routes: [] });

    const subLobby = FakeLobby.instances[1];
    expect(subLobby.broadcasts).toContainEqual({
      type: SUB_LOBBY_PACKET_TYPES.projectUpdate,
      payload: {
        project: { version: 2, modules: [{ id: 'local-change' }], routes: [] },
        reason: 'local-change',
        fromRole: 'host',
      },
    });

    subLobby.emitData('guest-peer', {
      type: SUB_LOBBY_PACKET_TYPES.projectUpdate,
      payload: {
        project: { version: 3, modules: [{ id: 'remote-change' }], routes: [] },
        reason: 'guest-edit',
      },
    });

    expect(applied).toContainEqual({ version: 3, modules: [{ id: 'remote-change' }], routes: [] });
  });
});
