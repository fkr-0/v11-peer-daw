// V11 Peer DAW/src/app.js
// Main application module

import { PeernetLobby } from '../vendor/peernet-lib.js';
import { AudioGraphSync } from './core/audio-graph-sync.js';
import { AudioRuntime } from './core/audio.js';
import { Arrangement, Clip, ClipSlot } from './core/clips-arrangement.js';
import { PortType } from './core/contracts.js';
import {
  midiToNoteName as formatMidiNoteName,
  gridCellKey as makeGridCellKey,
  gridDataFromKey as parseGridDataFromKey,
  noteNameToMidi as parseNoteNameToMidi,
  selectedGridData as selectionToGridData,
} from './core/grid-state.js';
import {
  clipCapableModules as selectClipCapableModules,
  isPatternModule as selectIsPatternModule,
  isSamplerModule as selectIsSamplerModule,
  mixerModules as selectMixerModules,
  workspaceModules as selectWorkspaceModules,
} from './core/module-selectors.js';
import { PatchBay } from './core/patchbay.js';
import { PeernetStack } from './core/peernet-stack.js';
import { PROJECT_SYNC_CHANNEL, ProjectSyncState } from './core/project-sync.js';
import { createProjectPackage, parseProjectPayload } from './core/project-io.js';
import {
  createProjectSource,
  serializeClipState as serializeClipStateSnapshot,
  serializeMixerState as serializeMixerStateSnapshot,
  serializeRig as serializeRigSnapshot,
} from './core/project-state.js';
import { RoutingGraph } from './core/routing-graph.js';
import {
  SAMPLE_PACKET_TYPES,
  SampleLibrary,
  SampleSyncManager,
  detectProjectSampleSlots,
  detectProjectSampleUsage,
  normalizeSampleMetadata,
} from './core/sample-library.js';
import { SubLobbyManager } from './core/sub-lobby-manager.js';
import { WorkspacePreferences } from './core/workspace-preferences.js';
import {
  clonePeerDawExampleProject,
  peerDawExampleProjects,
} from './examples/peer-daw-example-projects.js';
import { createDefaultPeerDawRig, moduleFactories } from './modules/catalog.js';
import { exportComposedPresetBankJson } from './modules/composed-soundscape-presets.js';
import { PatchCanvas } from './ui/patch-canvas.js';
import {
  renderProjectSampleUsageHtml,
  renderSampleLibraryMatrixHtml,
  renderSampleLibraryTreeHtml,
} from './ui/sample-panel-renderer.js';
import { APP_VERSION } from './version.js';

class V11PeerDAW {
  constructor() {
    this.runtime = new AudioRuntime();
    this.patchBay = new PatchBay();
    this.modulesEl = document.querySelector('#modules');
    this.routesEl = document.querySelector('#routes');
    this.logEl = document.querySelector('#eventLog');
    this.statusEl = document.querySelector('#audioStatus');
    this.mixerStripEl = document.querySelector('#mixerStrip');
    this.patchCanvasEl = document.querySelector('#patchCanvas');
    this.routingGraph = new RoutingGraph();
    this.graphSync = null;
    this.patchCanvas = null;
    this.workspacePreferences = new WorkspacePreferences();
    this.clock = null;
    this.mixer = null;
    this.focusedModuleId = null;
    this.selectedChainId = null;
    this.selectedSampleId = null;
    this.currentBeat = 0;
    this.mixerState = { masterVolume: 0.8, channels: {} };
    this.clipSlotSequence = 1;
    this.clipSlots = [];
    this.arrangement = new Arrangement({ loopStartBeat: 0, loopEndBeat: 16 });
    this.peernet = new PeernetStack({
      namespace: 'v11-peer-daw',
      capture: () => this.serializeRig(),
      apply: (payload) => this.applyRig(payload),
    });

    // Session state
    this.urlParams = new URLSearchParams(window.location.search);
    this.sessionCode = this.normalizeSessionCode(this.urlParams.get('session')) || null;
    this.targetPeerId = this.urlParams.get('targetPeerId') || '';
    this.spectateMode =
      this.urlParams.get('spectate') === 'true' || this.urlParams.get('observe') === 'true';
    this.localSyncDisabled = this.urlParams.get('localSync') === 'false';
    this.defaultSessionCode =
      this.normalizeSessionCode(this.urlParams.get('session')) || 'V11-OPEN-STUDIO';
    this.peerList = [];
    this.workspaceView = 'session';
    this.suppressProjectBroadcast = false;
    this.clientId = `v11-client-${Math.random().toString(36).slice(2, 10)}`;
    this.projectSync = new ProjectSyncState({
      clientId: this.clientId,
      sessionCode: this.defaultSessionCode,
    });
    this.localProjectVersion = 0;
    this.lastAppliedProjectStamp = { version: 0, clientId: '' };
    this.localProjectVersionsByClient = new Map();
    this.resolvedLocalConflicts = new Set();
    this.localSessionPeers = new Map();
    this.localSessionBus = null;
    this.localSessionHeartbeatTimer = null;
    this.localSessionPruneTimer = null;
    this.localSessionSyncTimer = null;
    this.localSessionBeforeUnloadBound = false;
    this.localSyncStatus = 'starting';
    this.localSyncRequestId = null;
    this.projectSyncRequestAttempt = 0;
    this.lastLocalSyncAt = 0;
    this.gridSelection = new Set();
    this.gridDrag = null;
    this.gridClipboard = [];
    this.waveformEdits = new Map();
    this.arrangementDrag = null;
    this._renderScheduled = false;
    this._transportStep = 0;
    this._transportStartTime = 0;
    this.commandCenterIndex = 0;
    this.commandCenterMatches = [];
    this.commandCenterReturnFocus = null;
    this.peernetHealth = null;
    this.peernetProjectSyncConnected = false;
    this.sampleLibrary = new SampleLibrary();
    this.pendingSampleUploadSlotId = null;
    this.sampleSyncProgress = new Map();
    this.sampleSync = new SampleSyncManager({
      library: this.sampleLibrary,
      send: (packet) => this.sendSampleSyncPacket(packet),
    });
    this.subLobby = new SubLobbyManager({
      username: 'pilot',
      lobbyFactory: (lobbyId, opts) => new PeernetLobby(lobbyId, opts),
      projectProvider: () => this.serializeRig(),
      projectConsumer: (project) => this.applyRemoteProject(project),
      autoCreateWhenAlone: false,
      autoJoinOffers: true,
    });
  }

  renderLocalSyncStatus() {
    const node = document.querySelector('#projectSyncSummary');
    if (!node) return;
    const labels = {
      starting: 'starting…',
      requesting: 'requesting room snapshot…',
      synced: 'synced',
      published: 'local change published',
      resolved: 'conflict resolved',
      acknowledged: 'remote peer acknowledged',
      unsynced: 'connected but no room snapshot received',
      'remote-only': 'remote transport only',
      'local-only': 'local-only · no room snapshot received',
      unavailable: 'local-only · browser channel unavailable',
    };
    const diagnostics = this.projectSync.diagnostics();
    const transportText = ['local', 'peernet']
      .map((transport) => {
        const activity = diagnostics.transports[transport];
        if (!activity) return null;
        const lastActivity = Math.max(activity.sentAt || 0, activity.receivedAt || 0);
        const time = lastActivity
          ? new Date(lastActivity).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : 'idle';
        return `${transport} ${activity.peerCount || 0}p @ ${time}`;
      })
      .filter(Boolean)
      .join(' · ');
    const time = this.lastLocalSyncAt
      ? ` · ${new Date(this.lastLocalSyncAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}`
      : '';
    const ack = diagnostics.lastAckClientId ? ` · ack ${diagnostics.lastAckClientId}` : '';
    node.textContent = `project sync: ${labels[this.localSyncStatus] || this.localSyncStatus}${time} · v${this.localProjectVersion}${ack}${transportText ? ` · ${transportText}` : ''}`;
    node.dataset.state = this.localSyncStatus;
  }

  normalizeSessionCode(value) {
    const normalized = String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .toUpperCase()
      .slice(0, 48);
    return normalized || null;
  }

  updateSessionUrl(code) {
    const url = new URL(window.location.href);
    url.searchParams.set('session', code);
    window.history?.replaceState?.({}, '', url);
    this.urlParams = new URLSearchParams(url.search);
  }

  async switchSessionCode(value, { updateUrl = true } = {}) {
    const nextCode = this.normalizeSessionCode(value);
    if (!nextCode) {
      this.logText('room switch ignored: enter a valid room code');
      return null;
    }
    if (nextCode === this.defaultSessionCode && this.localSessionBus) {
      this.requestLocalSessionProject();
      return this.peernet.sessions?.getActiveSession?.() || null;
    }
    this.closeLocalSessionBus({ announce: true });
    this.defaultSessionCode = nextCode;
    this.sessionCode = nextCode;
    this.projectSync.setSessionCode(nextCode);
    if (updateUrl) this.updateSessionUrl(nextCode);
    const session = await this.bootstrapDefaultPeernetSession({ force: true });
    this.bindLocalSessionBus();
    this.updateSessionUI();
    this.logText(`room switched: ${nextCode}`);
    return session;
  }

  sendProjectSyncMessage(message, { transport = 'all', peerId = '' } = {}) {
    const deliveries = [];
    if ((transport === 'all' || transport === 'local') && this.localSessionBus) {
      const sentAt = Date.now();
      this.localSessionBus.postMessage(message);
      const delivery = {
        sentAt,
        peerCount: this.localSessionPeers.size,
        delivered: this.localSessionPeers.size > 0,
      };
      this.projectSync.markSent('local', delivery);
      deliveries.push({ transport: 'local', ...delivery });
    }
    if ((transport === 'all' || transport === 'peernet') && this.peernet.started) {
      const delivery = this.peernet.send(PROJECT_SYNC_CHANNEL, message, peerId);
      this.projectSync.markSent('peernet', delivery);
      deliveries.push({ transport: 'peernet', ...delivery });
    }
    this.renderLocalSyncStatus();
    return deliveries;
  }

  requestLocalSessionProject({ attempt = 0, force = false } = {}) {
    if (!this.localSessionBus && !this.peernet.started) {
      this.localSyncStatus = 'unavailable';
      this.renderLocalSyncStatus();
      return null;
    }
    if (!force && this.localSyncStatus === 'synced') return this.localSyncRequestId;
    const request = this.projectSync.create('request', { attempt });
    this.localSyncRequestId = request.messageId;
    this.projectSyncRequestAttempt = attempt;
    this.localSyncStatus = 'requesting';
    this.sendProjectSyncMessage(request);
    window.clearTimeout(this.localSessionSyncTimer);
    const retryDelay = [900, 1600, 2600][attempt] || 2600;
    this.localSessionSyncTimer = window.setTimeout(() => {
      if (
        this.localSyncRequestId !== request.messageId ||
        this.localSyncStatus !== 'requesting'
      )
        return;
      if (attempt < 2) {
        this.requestLocalSessionProject({ attempt: attempt + 1, force: true });
        return;
      }
      this.localSyncStatus = this.peernet.health().connected ? 'unsynced' : 'local-only';
      this.renderLocalSyncStatus();
    }, retryDelay);
    return request.messageId;
  }

  sendLocalProjectSnapshot(message = {}, { transport = 'local', peerId = '' } = {}) {
    if (!message.clientId || !message.messageId) return;
    const snapshot = this.projectSync.create('snapshot', {
      targetClientId: message.clientId,
      requestId: message.messageId,
      version: this.localProjectVersion,
      stamp: this.lastAppliedProjectStamp,
      project: this.serializeRig(),
    });
    this.sendProjectSyncMessage(snapshot, { transport, peerId });
  }

  applyLocalProjectSnapshot(message = {}, { transport = 'local' } = {}) {
    if (message.targetClientId !== this.clientId || message.requestId !== this.localSyncRequestId)
      return;
    const stamp = message.stamp || {
      version: Number(message.version || 0),
      clientId: String(message.clientId || ''),
    };
    if (this.compareProjectStamp(stamp, this.lastAppliedProjectStamp) < 0) return;
    this.localProjectVersion = Math.max(
      this.localProjectVersion,
      Number(message.version || 0),
      Number(stamp.version || 0)
    );
    this.lastAppliedProjectStamp = stamp;
    this.localSyncStatus = 'synced';
    this.lastLocalSyncAt = Date.now();
    this.projectSyncRequestAttempt = 0;
    window.clearTimeout(this.localSessionSyncTimer);
    this.localSessionSyncTimer = null;
    this.logText(
      transport === 'local'
        ? `local session snapshot received from ${message.clientId}`
        : `Peernet room snapshot received from ${message.clientId}`
    );
    this.applyRemoteProject(message.project);
    this.renderLocalSyncStatus();
  }

  sendProjectSyncAck(message = {}, { transport = 'local', peerId = '' } = {}) {
    const ack = this.projectSync.create('ack', {
      targetClientId: message.clientId,
      ackFor: message.messageId,
      version: Number(message.version || 0),
    });
    this.sendProjectSyncMessage(ack, { transport, peerId });
  }

  handleProjectSyncMessage(message = {}, meta = {}) {
    const transport = meta.transport || 'unknown';
    if (!this.projectSync.accept(message, meta)) return;
    if (message.type === 'project-request') {
      this.sendLocalProjectSnapshot(message, { transport, peerId: meta.peerId || '' });
      return;
    }
    if (message.type === 'project-snapshot') {
      this.applyLocalProjectSnapshot(message, { transport });
      return;
    }
    if (message.type === 'project-ack') {
      if (message.targetClientId !== this.clientId) return;
      this.projectSync.markAck(message);
      this.localSyncStatus = 'acknowledged';
      this.lastLocalSyncAt = Date.now();
      this.renderLocalSyncStatus();
      return;
    }
    if (message.type !== 'project-update') return;
    this.sendProjectSyncAck(message, { transport, peerId: meta.peerId || '' });
    const incomingVersion = Number(message.version || 0);
    const seenVersion = Number(this.localProjectVersionsByClient.get(message.clientId) || 0);
    if (incomingVersion <= seenVersion) return;
    this.localProjectVersionsByClient.set(message.clientId, incomingVersion);
    this.localProjectVersion = Math.max(this.localProjectVersion, incomingVersion);
    const incomingStamp = { version: incomingVersion, clientId: String(message.clientId || '') };
    if (this.compareProjectStamp(incomingStamp, this.lastAppliedProjectStamp) <= 0) {
      this.rebroadcastWinningLocalProject(incomingStamp);
      return;
    }
    this.lastAppliedProjectStamp = incomingStamp;
    this.localSyncStatus = 'synced';
    this.lastLocalSyncAt = Date.now();
    this.logText(
      `${transport === 'peernet' ? 'Peernet' : 'local session'} project update: ${message.reason || 'remote-change'}`
    );
    this.applyRemoteProject(message.project);
    this.renderLocalSyncStatus();
  }

  rebroadcastWinningLocalProject(losingStamp = {}) {
    const winner = this.lastAppliedProjectStamp;
    if (winner.clientId !== this.clientId || losingStamp.clientId === this.clientId) return;
    const conflictKey = `${losingStamp.version}:${losingStamp.clientId}->${winner.version}:${winner.clientId}`;
    if (this.resolvedLocalConflicts.has(conflictKey)) return;
    this.resolvedLocalConflicts.add(conflictKey);
    if (this.resolvedLocalConflicts.size > 100) {
      this.resolvedLocalConflicts.delete(this.resolvedLocalConflicts.values().next().value);
    }
    this.publishLocalSessionProject('conflict-resolution');
  }

  async init() {
    this.renderAppVersion();
    this.createStarfield();
    this.bindExampleProjects();
    this.bindChrome();
    this.bindCommandCenter();
    this.bindModuleSearch();
    this.bindTransportBar();
    this.patchBay.addEventListener('packet', (e) => this.logPacket(e.detail));
    this.patchBay.addEventListener('route:add', () => this.renderRoutes());
    this.bindPatchCanvas();
    this.bindPeernetStack();
    await this.bootstrapDefaultRig();
    this.ensureDefaultClipSlots();
    this.sampleLibrary.load();
    this.bindSampleLibrary();
    this.renderSamplePanels();
    this.restoreDrawerStates();
    this.bindWorkspaceViews();
    this.restoreWorkspaceView();
    this.renderWorkspaceView();
    await this.bootstrapDefaultPeernetSession();
    this.bindLocalSessionBus();
    this.autoJoinFromUrl();
  }

  closeLocalSessionBus({ announce = false } = {}) {
    if (announce) this.announceLocalSessionPresence('leave');
    window.clearInterval(this.localSessionHeartbeatTimer);
    window.clearInterval(this.localSessionPruneTimer);
    window.clearTimeout(this.localSessionSyncTimer);
    this.localSessionHeartbeatTimer = null;
    this.localSessionPruneTimer = null;
    this.localSessionSyncTimer = null;
    this.localSessionBus?.close?.();
    this.localSessionBus = null;
    this.localSessionPeers.clear();
    this.localProjectVersion = 0;
    this.lastAppliedProjectStamp = { version: 0, clientId: '' };
    this.localProjectVersionsByClient.clear();
    this.resolvedLocalConflicts.clear();
    this.localSyncStatus = 'local-only';
    this.localSyncRequestId = null;
    this.projectSyncRequestAttempt = 0;
    this.lastLocalSyncAt = 0;
    this.renderPeerCounts();
    this.renderLocalSyncStatus();
  }

  bindLocalSessionBus({ force = false } = {}) {
    if (this.localSyncDisabled) {
      this.localSyncStatus = this.peernet.started ? 'remote-only' : 'unavailable';
      this.renderLocalSyncStatus();
      return;
    }
    if (!('BroadcastChannel' in window)) {
      this.localSyncStatus = this.peernet.started ? 'remote-only' : 'unavailable';
      this.renderLocalSyncStatus();
      return;
    }
    if (force) this.closeLocalSessionBus({ announce: true });
    if (this.localSessionBus) return;
    this.localSessionBus = new BroadcastChannel(`v11-peer-daw:${this.defaultSessionCode}`);
    this.localSessionBus.addEventListener('message', (event) =>
      this.handleLocalSessionMessage(event.data || {})
    );
    this.announceLocalSessionPresence('join');
    this.localSessionHeartbeatTimer = window.setInterval(
      () => this.announceLocalSessionPresence('heartbeat'),
      10000
    );
    this.localSessionPruneTimer = window.setInterval(() => this.pruneLocalSessionPeers(), 5000);
    this.requestLocalSessionProject();
    if (!this.localSessionBeforeUnloadBound) {
      this.localSessionBeforeUnloadBound = true;
      window.addEventListener('beforeunload', () =>
        this.closeLocalSessionBus({ announce: true })
      );
    }
  }

  announceLocalSessionPresence(kind = 'presence') {
    if (!this.localSessionBus) return;
    this.localSessionBus.postMessage({
      type: 'presence',
      kind,
      clientId: this.clientId,
      username: document.querySelector('#pilotName')?.value || 'pilot',
      sessionCode: this.defaultSessionCode,
      at: Date.now(),
    });
  }

  pruneLocalSessionPeers(maxAgeMs = 30000) {
    const cutoff = Date.now() - maxAgeMs;
    let changed = false;
    for (const [clientId, peer] of this.localSessionPeers) {
      if (Number(peer.at || 0) >= cutoff) continue;
      this.localSessionPeers.delete(clientId);
      changed = true;
    }
    if (changed) this.updateSessionUI();
  }

  handleLocalSessionMessage(message = {}) {
    if (
      !message ||
      message.clientId === this.clientId ||
      message.sessionCode !== this.defaultSessionCode
    )
      return;
    if (message.type === 'presence') {
      if (message.kind === 'leave') this.localSessionPeers.delete(message.clientId);
      else
        this.localSessionPeers.set(message.clientId, {
          id: message.clientId,
          name: message.username || 'peer',
          at: message.at || Date.now(),
        });
      if (message.kind === 'join') this.announceLocalSessionPresence('heartbeat');
      this.updateSessionUI();
      return;
    }
    this.handleProjectSyncMessage(message, {
      transport: 'local',
      receivedAt: Date.now(),
    });
  }

  compareProjectStamp(a = {}, b = {}) {
    const versionDelta = Number(a.version || 0) - Number(b.version || 0);
    if (versionDelta) return versionDelta;
    return String(a.clientId || '').localeCompare(String(b.clientId || ''));
  }

  publishLocalSessionProject(reason = 'local-change') {
    if ((!this.localSessionBus && !this.peernet.started) || this.suppressProjectBroadcast) return;
    this.localProjectVersion += 1;
    this.lastAppliedProjectStamp = {
      version: this.localProjectVersion,
      clientId: this.clientId,
    };
    this.localSyncStatus = reason === 'conflict-resolution' ? 'resolved' : 'published';
    this.lastLocalSyncAt = Date.now();
    const update = this.projectSync.create('update', {
      username: document.querySelector('#pilotName')?.value || 'pilot',
      version: this.localProjectVersion,
      reason,
      project: this.serializeRig(),
    });
    this.sendProjectSyncMessage(update);
  }

  bindExampleProjects() {
    const selector = document.querySelector('#exampleProjectSelect');
    if (!selector) return;
    selector.innerHTML = [
      '<option value="">load tutorial example…</option>',
      ...peerDawExampleProjects.map(
        (example) => `<option value="${example.id}">${example.title}</option>`
      ),
    ].join('');
    document.querySelector('#btnLoadExampleProject')?.addEventListener('click', () => {
      this.loadExampleProject(selector.value);
    });
    document.querySelector('#btnStageExampleProject')?.addEventListener('click', () => {
      this.stageExampleProject(selector.value);
    });
  }

  exampleProjectText(example) {
    return JSON.stringify(example, null, 2);
  }

  selectedExampleProject(exampleId) {
    const id = exampleId || document.querySelector('#exampleProjectSelect')?.value;
    return id ? clonePeerDawExampleProject(id) : null;
  }

  stageExampleProject(exampleId) {
    const example = this.selectedExampleProject(exampleId);
    if (!example) {
      this.logText('choose an example set first');
      return null;
    }
    document.querySelector('#projectIoText').value = this.exampleProjectText(example);
    this.logText(`example staged: ${example.title}`);
    return example;
  }

  async loadExampleProject(exampleId) {
    const example = this.stageExampleProject(exampleId);
    if (!example) return;
    await this.rebuildRigFromProject(example);
    this.logText(`example loaded: ${example.title}`);
  }

  renderAppVersion() {
    const badge = document.querySelector('#appVersion');
    if (badge) badge.textContent = `v${APP_VERSION}`;
    document.documentElement.dataset.appVersion = APP_VERSION;
  }

  createStarfield() {
    const root = document.querySelector('#starfield');
    if (!root) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const lowPower =
      Number(navigator.hardwareConcurrency || 8) <= 4 || Number(navigator.deviceMemory || 8) <= 4;
    const count = reducedMotion ? 0 : lowPower ? 36 : 72;
    root.dataset.density = lowPower ? 'low' : 'normal';
    root.innerHTML = Array.from({ length: count }, (_, _i) => {
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const s = 1 + Math.random() * 2;
      const d = 1.5 + Math.random() * 4;
      const opacity = 0.3 + Math.random() * 0.7;
      return `<i style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-duration:${d}s;--opacity:${opacity}"></i>`;
    }).join('');
    document.addEventListener('visibilitychange', () => {
      root.classList.toggle('paused', document.hidden);
    });
  }

  sessionInviteUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('session', this.sessionCode || this.defaultSessionCode);
    url.searchParams.set(
      'username',
      document.querySelector('#pilotName')?.value?.trim() || 'pilot'
    );
    url.searchParams.delete('targetPeerId');
    url.searchParams.delete('observe');
    url.searchParams.delete('spectate');
    return url.toString();
  }

  async copySessionInvite() {
    const invite = this.sessionInviteUrl();
    try {
      await navigator.clipboard?.writeText?.(invite);
      this.logText(`session invite copied: ${this.sessionCode || this.defaultSessionCode}`);
    } catch {
      window.prompt?.('Copy session invite', invite);
      this.logText('session invite ready for manual copy');
    }
  }

  bindChrome() {
    document.querySelector('#btnBootAudio').addEventListener('click', async () => {
      await this.runtime.init();
      this.statusEl.textContent = `audio: ${this.runtime.context.state}`;
      await this.startAudioModules();
    });

    document.querySelector('#btnStart').addEventListener('click', async () => {
      await this.runtime.init();
      await this.startAudioModules();
      this.clock?.start(this.runtime.context);
    });

    document.querySelector('#btnStop').addEventListener('click', () => {
      this.clock?.stop();
      this.statusEl.textContent = 'audio: stopped';
    });

    document.addEventListener('keydown', async (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.clock?._running) {
          this.clock.stop();
          this.statusEl.textContent = 'audio: stopped';
        } else {
          try {
            await this.runtime.init();
            await this.startAudioModules();
            this.clock?.start(this.runtime.context);
            this.statusEl.textContent = `audio: ${this.runtime.context.state}`;
          } catch (error) {
            this.logText(`audio start failed: ${error.message}`);
          }
        }
      }
    });

    document
      .querySelector('#btnCopyInvite')
      ?.addEventListener('click', () => this.copySessionInvite());
    document
      .querySelector('#btnSyncSession')
      ?.addEventListener('click', () => this.requestLocalSessionProject({ force: true }));
    document
      .querySelector('#btnJoinSession')
      ?.addEventListener('click', () =>
        this.switchSessionCode(document.querySelector('#sessionCodeInput')?.value)
      );
    document.querySelector('#sessionCodeInput')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.switchSessionCode(event.currentTarget.value);
    });

    document.querySelector('#btnConnectPeer').addEventListener('click', async () => {
      await this.bootstrapDefaultPeernetSession({ force: true });
      this.logText('visible in app-hub lobby as V11 DAW');
    });

    document.querySelector('#btnCreateSession').addEventListener('click', () => {
      const session = this.peernet.createSession('V11 Peer DAW Session');
      if (session) {
        this.switchSessionCode(session.code).then(() =>
          this.logText(`session created: ${session.title}`)
        );
      }
    });

    document
      .querySelector('#btnWorkspaceReset')
      ?.addEventListener('click', () => this.setWorkspaceView('session'));

    document.querySelector('#btnSaveSnapshot').addEventListener('click', () => {
      const snap = this.peernet.snapshot('Manual V11 Peer DAW Snapshot');
      if (snap) this.logText(`storage snapshot: ${snap.title}`);
    });

    document.querySelector('#blockIncomingJoin')?.addEventListener('change', (event) => {
      this.subLobby.setBlockIncoming(Boolean(event.target.checked));
      this.logText(`sub-lobby auto-join ${event.target.checked ? 'blocked' : 'open'}`);
    });

    document.querySelector('#btnHostSubLobby')?.addEventListener('click', async () => {
      await this.ensureSubLobbyConnected();
      await this.subLobby.createHostedSubLobby({ carryCurrentProject: true });
      this.logText('hosted shared DAW sub-lobby');
    });

    document.querySelector('#btnNewSubLobby')?.addEventListener('click', async () => {
      await this.ensureSubLobbyConnected();
      await this.subLobby.createHostedSubLobby({ carryCurrentProject: false });
      this.logText('spawned new empty DAW sub-lobby');
    });

    document.querySelector('#btnCarrySubLobby')?.addEventListener('click', async () => {
      await this.ensureSubLobbyConnected();
      await this.subLobby.createHostedSubLobby({ carryCurrentProject: true });
      this.logText('spawned carried-project DAW sub-lobby');
    });

    document.querySelector('#addModule').addEventListener('change', async (e) => {
      const factory = moduleFactories[e.target.value];
      e.target.value = '';
      if (!factory) return;
      const module = factory();
      await this.addModule(module, { autoConnectAudio: true });
      this.autopatch(module);
    });

    // Patch canvas controls
    document.querySelector('#btnAutoPatch')?.addEventListener('click', () => {
      this.logText('Auto-patch enabled for new modules');
    });

    document.querySelector('#btnClearRoutes')?.addEventListener('click', () => {
      this.patchBay.routes = [];
      this.routingGraph.clearEdges();
      this.syncAudioGraph();
      this.renderRoutes();
      this.renderPatchCanvas();
      this.logText('All routes cleared');
      this.publishProjectChange('routes-cleared');
    });

    document.querySelector('#btnCopyProject')?.addEventListener('click', () => this.copyProject());
    document
      .querySelector('#btnPasteProject')
      ?.addEventListener('click', () => this.pasteProject());
    document
      .querySelector('#btnDownloadProject')
      ?.addEventListener('click', () => this.downloadProject());
    document.querySelector('#projectImportFile')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) this.importProjectFile(file);
      event.target.value = '';
    });

    document
      .querySelector('#sampleLibraryUploadFile')
      ?.addEventListener('change', async (event) => {
        await this.importSampleLibraryFiles(event.target.files || []);
        event.target.value = '';
      });
    document
      .querySelector('#sampleLibraryImportFile')
      ?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) await this.importSampleLibraryJsonFile(file);
        event.target.value = '';
      });
    document
      .querySelector('#btnExportSampleLibrary')
      ?.addEventListener('click', () => this.exportSampleLibraryJson());
    document
      .querySelector('#btnExportComposedSoundscapes')
      ?.addEventListener('click', () => this.exportComposedSoundscapePresets());
    document.querySelector('#sampleLibraryJson')?.addEventListener('change', (event) => {
      const text = event.target.value.trim();
      if (!text) return;
      try {
        this.sampleLibrary.importSnapshot(JSON.parse(text)).save();
        this.renderSamplePanels();
        this.logText('global sample library JSON imported');
      } catch (error) {
        this.logText(`sample library JSON parse error: ${error.message}`);
      }
    });
  }

  commandSearchScore(entry, query = '') {
    const normalized = String(query).trim().toLowerCase();
    if (!normalized) return entry.priority || 0;
    const terms = normalized.split(/\s+/).filter(Boolean);
    const title = entry.title.toLowerCase();
    const haystack = `${entry.title} ${entry.detail || ''} ${entry.keywords || ''}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return -1;
    let score = terms.reduce(
      (total, term) => total + (title.startsWith(term) ? 32 : title.includes(term) ? 18 : 7),
      0
    );
    if (title === normalized) score += 80;
    return score + (entry.priority || 0);
  }

  commandCenterEntries() {
    const workspaceViews = [
      [
        'session',
        'Session Dashboard',
        'Shared-session state, participants, rig, and network health',
      ],
      ['chains', 'Signal Flow', 'Inspect derived module chains and routing'],
      ['clips', 'Clip Launcher', 'Create, launch, stop, and place clips'],
      ['samples', 'Sample Library', 'Assign and repair project samples'],
      ['arrangement', 'Arrangement', 'Edit the timeline and clip regions'],
      ['mixer', 'Mixer', 'Open channel, bus, pan, mute, and level controls'],
      ['module', 'Focused Module', 'Open the full editor for the selected module'],
    ].map(([view, title, detail], index) => ({
      id: `view:${view}`,
      title: `Open ${title}`,
      detail,
      kind: 'view',
      keywords: `${view} workspace tab navigate`,
      priority: 30 - index,
      run: () => this.setWorkspaceView(view),
    }));

    const actions = [
      {
        id: 'transport:boot',
        title: 'Boot Audio Engine',
        detail: 'Initialize Web Audio and start all audio-capable modules',
        kind: 'transport',
        keywords: 'audio engine initialize resume',
        priority: 22,
        run: () => document.querySelector('#btnBootAudio')?.click(),
      },
      {
        id: 'transport:start',
        title: 'Start Clock',
        detail: 'Start playback and transport timing',
        kind: 'transport',
        keywords: 'play transport clock space',
        priority: 21,
        run: () => document.querySelector('#btnStart')?.click(),
      },
      {
        id: 'transport:stop',
        title: 'Stop Clock',
        detail: 'Stop playback immediately',
        kind: 'transport',
        keywords: 'stop transport clock',
        priority: 20,
        run: () => document.querySelector('#btnStop')?.click(),
      },
      {
        id: 'peer:connect',
        title: 'Reconnect Shared Studio',
        detail: 'Restart the Peernet session while preserving the current project',
        kind: 'network',
        keywords: 'peer reconnect retry health session',
        priority: 18,
        run: () => this.bootstrapDefaultPeernetSession({ force: true }),
      },
      {
        id: 'session:create',
        title: 'Create Session',
        detail: 'Create a named collaboration session from the current rig',
        kind: 'session',
        keywords: 'room collaborate share code',
        priority: 15,
        run: () => document.querySelector('#btnCreateSession')?.click(),
      },
      {
        id: 'project:snapshot',
        title: 'Save Project Snapshot',
        detail: 'Capture the current rig into local Peernet storage',
        kind: 'project',
        keywords: 'save snapshot backup storage',
        priority: 14,
        run: () => document.querySelector('#btnSaveSnapshot')?.click(),
      },
      {
        id: 'module:focus-search',
        title: 'Focus Module Filter',
        detail: 'Filter the module catalog in the left sidebar',
        kind: 'navigate',
        keywords: 'find add module search sidebar',
        priority: 12,
        run: () => document.querySelector('#moduleSearch')?.focus(),
      },
    ];

    const moduleSelect = document.querySelector('#addModule');
    const modules = [
      ...(moduleSelect?.querySelectorAll('option[value]:not([value=""])') || []),
    ].map((option) => ({
      id: `module:add:${option.value}`,
      title: `Add ${option.textContent.trim()}`,
      detail: `Create and auto-patch a ${option.parentElement?.label || 'module'}`,
      kind: 'module',
      keywords: `${option.value} ${option.parentElement?.label || ''} instrument effect sequencer`,
      priority: 5,
      run: () => {
        moduleSelect.value = option.value;
        moduleSelect.dispatchEvent(new Event('change', { bubbles: true }));
      },
    }));

    const examples = peerDawExampleProjects.map((example) => ({
      id: `example:${example.id}`,
      title: `Load ${example.title}`,
      detail: example.description || 'Replace the current rig with this tutorial project',
      kind: 'example',
      keywords: `${example.id} tutorial demo project`,
      priority: 4,
      run: () => this.loadExampleProject(example.id),
    }));

    return [...workspaceViews, ...actions, ...modules, ...examples];
  }

  setCommandCenterIndex(index) {
    const results = document.querySelector('#commandCenterResults');
    if (!this.commandCenterMatches.length) {
      this.commandCenterIndex = 0;
      return;
    }
    this.commandCenterIndex =
      (index + this.commandCenterMatches.length) % this.commandCenterMatches.length;
    results?.querySelectorAll('[data-command-index]').forEach((node) => {
      const active = Number(node.dataset.commandIndex) === this.commandCenterIndex;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', String(active));
      if (active) {
        document
          .querySelector('#commandCenterInput')
          ?.setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  renderCommandCenter() {
    const input = document.querySelector('#commandCenterInput');
    const results = document.querySelector('#commandCenterResults');
    if (!input || !results) return;
    this.commandCenterMatches = this.commandCenterEntries()
      .map((entry) => ({ entry, score: this.commandSearchScore(entry, input.value) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
      .slice(0, 20)
      .map(({ entry }) => entry);
    this.commandCenterIndex = Math.min(
      this.commandCenterIndex,
      Math.max(0, this.commandCenterMatches.length - 1)
    );
    results.innerHTML = this.commandCenterMatches.length
      ? this.commandCenterMatches
          .map(
            (entry, index) =>
              `<button id="daw-command-option-${index}" class="command-center-result ${index === this.commandCenterIndex ? 'active' : ''}" type="button" role="option" aria-selected="${index === this.commandCenterIndex}" data-command-index="${index}"><span class="command-center-result-main"><strong class="command-center-result-title">${this.escapeHtml(entry.title)}</strong><span class="command-center-result-detail">${this.escapeHtml(entry.detail || entry.keywords || '')}</span></span><span class="command-center-result-kind">${this.escapeHtml(entry.kind)}</span></button>`
          )
          .join('')
      : '<div class="command-center-empty">No matching DAW command.</div>';
    results.querySelectorAll('[data-command-index]').forEach((node) => {
      node.addEventListener('pointerenter', () =>
        this.setCommandCenterIndex(Number(node.dataset.commandIndex))
      );
      node.addEventListener('click', () =>
        this.runCommandCenterEntry(Number(node.dataset.commandIndex))
      );
    });
    this.setCommandCenterIndex(this.commandCenterIndex);
  }

  renderPeernetHealth(health = this.peernet.health()) {
    this.peernetHealth = health || this.peernet.health();
    const state = this.peernetHealth?.state || 'idle';
    const role = this.peernetHealth?.role || 'offline';
    const peerCount = Number(this.peernetHealth?.peerCount || 0);
    const text = `peer: ${state} · ${role} · ${peerCount}`;
    for (const selector of ['#peerStatus', '#commandCenterHealth']) {
      const node = document.querySelector(selector);
      if (!node) continue;
      node.textContent = text;
      node.dataset.state = state;
      node.title = this.peernetHealth?.lastError
        ? `last error: ${this.peernetHealth.lastError}`
        : `hub ${this.peernetHealth?.hubId || this.defaultSessionCode}`;
    }
    const summary = document.querySelector('#sessionHealthSummary');
    if (summary) {
      const localCount = this.localSessionPeers.size;
      const directCount = this.peerList.length;
      summary.textContent = this.peernetHealth?.lastError
        ? `${state} · ${role} · ${this.peernetHealth.lastError}`
        : `${state} · ${role} · ${directCount} direct · ${localCount} local`;
      summary.dataset.state = state;
    }
    this.renderPeerCounts();
    if (this.workspaceView === 'session') this.scheduleRender();
  }

  handlePeernetProjectSyncHealth(health = this.peernet.health()) {
    const connected = Boolean(health?.connected);
    if (!connected) {
      this.peernetProjectSyncConnected = false;
      return;
    }
    if (this.peernetProjectSyncConnected) return;
    this.peernetProjectSyncConnected = true;
    window.setTimeout(
      () => this.requestLocalSessionProject({ force: true }),
      120
    );
  }

  openCommandCenter(initialQuery = '') {
    const center = document.querySelector('#commandCenter');
    const input = document.querySelector('#commandCenterInput');
    if (!center || !input) return;
    this.commandCenterReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : document.querySelector('#btnCommandCenter');
    center.classList.add('open');
    center.setAttribute('aria-hidden', 'false');
    input.value = initialQuery;
    this.commandCenterIndex = 0;
    this.renderPeernetHealth();
    this.renderCommandCenter();
    input.focus({ preventScroll: true });
  }

  closeCommandCenter() {
    const center = document.querySelector('#commandCenter');
    if (!center?.classList.contains('open')) return;
    center.classList.remove('open');
    center.setAttribute('aria-hidden', 'true');
    document.querySelector('#commandCenterInput')?.removeAttribute('aria-activedescendant');
    this.commandCenterReturnFocus?.focus?.();
    this.commandCenterReturnFocus = null;
  }

  async runCommandCenterEntry(index = this.commandCenterIndex) {
    const entry = this.commandCenterMatches[index];
    if (!entry) return;
    this.closeCommandCenter();
    try {
      await entry.run?.();
      this.logText(`command: ${entry.title}`);
    } catch (error) {
      this.logText(`command failed: ${entry.title} · ${error.message}`);
    }
  }

  bindCommandCenter() {
    const center = document.querySelector('#commandCenter');
    const input = document.querySelector('#commandCenterInput');
    document
      .querySelector('#btnCommandCenter')
      ?.addEventListener('click', () => this.openCommandCenter());
    center
      ?.querySelectorAll('[data-command-close]')
      .forEach((node) => node.addEventListener('click', () => this.closeCommandCenter()));
    input?.addEventListener('input', () => {
      this.commandCenterIndex = 0;
      this.renderCommandCenter();
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.setCommandCenterIndex(this.commandCenterIndex + 1);
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.setCommandCenterIndex(this.commandCenterIndex - 1);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.runCommandCenterEntry();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeCommandCenter();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && center?.classList.contains('open')) {
        const focusable = [
          ...center.querySelectorAll("input, button, [href], [tabindex]:not([tabindex='-1'])"),
        ].filter((node) => !node.disabled && node.offsetParent !== null);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        center?.classList.contains('open') ? this.closeCommandCenter() : this.openCommandCenter();
        return;
      }
      if (event.key === 'Escape') this.closeCommandCenter();
    });
    this.renderPeernetHealth();
  }

  bindModuleSearch() {
    const searchInput = document.querySelector('#moduleSearch');
    const select = document.querySelector('#addModule');
    if (!searchInput || !select) return;
    const allOptions = [...select.querySelectorAll('option[value]:not([value=""])')];
    const optgroups = [...select.querySelectorAll('optgroup')];
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      if (!query) {
        allOptions.forEach((opt) => {
          opt.hidden = false;
        });
        optgroups.forEach((og) => {
          og.hidden = false;
        });
        return;
      }
      allOptions.forEach((opt) => {
        opt.hidden = !opt.textContent.toLowerCase().includes(query);
      });
      optgroups.forEach((og) => {
        const visibleChildren = [...og.querySelectorAll('option')].some((opt) => !opt.hidden);
        og.hidden = !visibleChildren;
      });
    });
  }

  bindTransportBar() {
    this.patchBay.addEventListener('packet', (e) => {
      const packet = e.detail?.packet;
      if (packet?.kind === PortType.CLOCK && packet.type === 'step') {
        this._transportStep = packet.step;
        if (packet.step === 0) this._transportStartTime = Date.now();
        this.updateTransportBar(packet.bpm || 120, packet.step);
      }
    });
  }

  updateTransportBar(bpm, step) {
    const bar = Math.floor(step / 16) + 1;
    const beatInBar = Math.floor((step % 16) / 4) + 1;
    const beatDisplay = document.querySelector('#beatDisplay');
    const bpmDisplay = document.querySelector('#transportBpm');
    const timeDisplay = document.querySelector('#transportTime');
    const pulse = document.querySelector('#beatPulse');
    if (beatDisplay) beatDisplay.textContent = `${bar}.${beatInBar}`;
    if (bpmDisplay) bpmDisplay.textContent = String(bpm);
    if (timeDisplay) {
      const elapsedMs = Date.now() - this._transportStartTime;
      const sec = Math.floor(elapsedMs / 1000);
      const min = Math.floor(sec / 60);
      timeDisplay.textContent = `${min}:${String(sec % 60).padStart(2, '0')}`;
    }
    if (pulse && step % 4 === 0) {
      pulse.classList.add('on');
      setTimeout(() => pulse.classList.remove('on'), 100);
    }
  }

  updateTransportStats() {
    const modEl = document.querySelector('#transportModules');
    const routeEl = document.querySelector('#transportRoutes');
    if (modEl) modEl.textContent = `${this.patchBay.modules.size} modules`;
    if (routeEl) routeEl.textContent = `${this.patchBay.routes.length} routes`;
  }

  bindWorkspaceViews() {
    document.querySelectorAll('[data-workspace-view]').forEach((button) => {
      button.addEventListener('click', () => this.setWorkspaceView(button.dataset.workspaceView));
    });
    const workspace = document.querySelector('#workspaceMainView');
    workspace?.addEventListener('click', (event) => {
      const clipAction = event.target.closest('[data-clip-action]');
      if (clipAction) {
        this.handleClipAction(clipAction.dataset.clipAction, clipAction.dataset.slotId || '');
        return;
      }
      const arrangementAction = event.target.closest('[data-arrangement-action]');
      if (arrangementAction) {
        this.handleArrangementAction(
          arrangementAction.dataset.arrangementAction,
          arrangementAction
        );
        return;
      }
      const sampleAction = event.target.closest('[data-sample-action]');
      if (sampleAction) {
        this.handleSampleAction(sampleAction);
        return;
      }
      const moduleAction = event.target.closest('[data-module-action]');
      if (moduleAction) {
        this.handleModuleAction(moduleAction.dataset.moduleAction, moduleAction);
        return;
      }
      const chainAction = event.target.closest('[data-chain-action="view-chain"]');
      if (chainAction) {
        this.openSignalFlowForModule(chainAction.dataset.moduleId || '');
        return;
      }
      const workspaceViewAction = event.target.closest('[data-workspace-view]');
      if (workspaceViewAction) this.setWorkspaceView(workspaceViewAction.dataset.workspaceView);
    });
    workspace?.addEventListener('pointerdown', (event) => this.handleArrangementPointerDown(event));
    workspace?.addEventListener('pointermove', (event) => this.handleArrangementPointerMove(event));
    workspace?.addEventListener('pointerdown', (event) => this.handleGridPointerDown(event));
    workspace?.addEventListener('pointerover', (event) => this.handleGridPointerOver(event));
    workspace?.addEventListener('pointerup', () => {
      this.endArrangementDrag();
      this.endGridDrag();
    });
    workspace?.addEventListener('pointercancel', () => {
      this.endArrangementDrag();
      this.endGridDrag();
    });
    document.addEventListener('pointerup', () => {
      this.endArrangementDrag();
      this.endGridDrag();
    });
    document.addEventListener('keydown', (event) => this.handleGridShortcut(event));
    workspace?.addEventListener('input', (event) => this.handleWorkspaceInput(event));
    workspace?.addEventListener('change', (event) => {
      this.handleWorkspaceInput(event);
      this.handleDrumPadFileInput(event);
    });
  }

  gridCellKey(data = {}) {
    return makeGridCellKey(data);
  }

  gridCellSelected(data = {}) {
    return this.gridSelection.has(this.gridCellKey(data));
  }

  cellDataFromElement(el) {
    return { ...(el?.dataset || {}) };
  }

  selectGridCell(data, { append = false, selected = true } = {}) {
    if (!append) this.gridSelection.clear();
    const key = this.gridCellKey(data);
    if (selected) this.gridSelection.add(key);
    else this.gridSelection.delete(key);
  }

  handleGridPointerDown(event) {
    const cell = event.target.closest('[data-grid-cell]');
    if (!cell) return;
    const data = this.cellDataFromElement(cell);
    const copy = event.ctrlKey || event.metaKey;
    const erase = event.altKey;
    const append = event.shiftKey;
    this.gridDrag = {
      moduleId: data.moduleId,
      kind: data.gridKind,
      copy,
      erase,
      append,
      source: data,
      sourceState: this.readGridCellState(data),
      targetState: erase
        ? false
        : copy
          ? this.readGridCellState(data)
          : !this.readGridCellState(data),
      seen: new Set(),
    };
    if (append) this.selectGridCell(data, { append: true, selected: !this.gridCellSelected(data) });
    else this.applyGridDragCell(data);
    event.preventDefault();
  }

  handleGridPointerOver(event) {
    if (!this.gridDrag || event.buttons !== 1) return;
    const cell = event.target.closest('[data-grid-cell]');
    if (!cell) return;
    const data = this.cellDataFromElement(cell);
    if (data.moduleId !== this.gridDrag.moduleId || data.gridKind !== this.gridDrag.kind) return;
    this.applyGridDragCell(data);
  }

  endGridDrag() {
    if (!this.gridDrag) return;
    const reason = this.gridDrag.copy
      ? 'grid-copy-drag'
      : this.gridDrag.erase
        ? 'grid-erase-drag'
        : this.gridDrag.append
          ? 'grid-select-drag'
          : 'grid-drag-edit';
    this.gridDrag = null;
    this.renderWorkspaceView();
    this.publishProjectChange(reason);
  }

  handleGridShortcut(event) {
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
    if (!this.gridSelection.size) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'd') {
      event.preventDefault();
      this.duplicateGridSelection();
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      this.eraseGridSelection();
      return;
    }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault();
      this.editGridSelectionWithKeyboard(event.key, {
        shift: event.shiftKey,
        alt: event.altKey,
        copy: event.ctrlKey || event.metaKey,
      });
    }
  }

  noteNameToMidi(note = 'C4') {
    return parseNoteNameToMidi(note);
  }

  midiToNoteName(midi = 60) {
    return formatMidiNoteName(midi);
  }

  gridDataFromKey(key) {
    return parseGridDataFromKey(key);
  }

  selectedGridData() {
    return selectionToGridData(this.gridSelection);
  }

  findPianoNote(module, data) {
    const stepResolution = module.stepResolutionBeats || 0.25;
    return module.notes?.find(
      (note) =>
        note.note === data.note && Math.round(note.beat / stepResolution) === Number(data.step)
    );
  }

  eraseGridSelection() {
    for (const data of this.selectedGridData()) this.writeGridCell(data, false);
    const count = this.gridSelection.size;
    this.gridSelection.clear();
    this.logText(`erased ${count} grid cells`);
    this.renderWorkspaceView();
    this.publishProjectChange('grid-erase-selection');
  }

  editGridSelectionWithKeyboard(key, modifiers = {}) {
    const selected = this.selectedGridData();
    const nextSelection = new Set();
    for (const data of selected) {
      const module = this.patchBay.modules.get(data.moduleId);
      if (!module) continue;
      if (data.gridKind === 'piano') {
        const stepResolution = module.stepResolutionBeats || 0.25;
        const note = this.findPianoNote(module, data);
        if (!note) continue;
        if (modifiers.shift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          const delta = key === 'ArrowRight' ? stepResolution : -stepResolution;
          note.duration = Math.max(
            stepResolution,
            Number((Number(note.duration || stepResolution) + delta).toFixed(6))
          );
          nextSelection.add(this.gridCellKey(data));
          continue;
        }
        if (modifiers.shift && (key === 'ArrowUp' || key === 'ArrowDown')) {
          const delta = key === 'ArrowUp' ? 0.05 : -0.05;
          note.velocity = Math.max(
            0,
            Math.min(1, Number((Number(note.velocity || 0.8) + delta).toFixed(2)))
          );
          nextSelection.add(this.gridCellKey(data));
          continue;
        }
        const target = { ...data };
        if (key === 'ArrowRight' || key === 'ArrowLeft') {
          const deltaSteps = key === 'ArrowRight' ? 1 : -1;
          if (modifiers.copy)
            this.writeGridCell(
              { ...data, step: String(Number(data.step) + deltaSteps) },
              true,
              data
            );
          else
            note.beat = Math.max(
              0,
              Number((Number(note.beat || 0) + deltaSteps * stepResolution).toFixed(6))
            );
          target.step = String(Math.max(0, Number(data.step) + deltaSteps));
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          const deltaMidi = key === 'ArrowUp' ? 1 : -1;
          if (modifiers.copy)
            this.writeGridCell(
              { ...data, note: this.midiToNoteName(this.noteNameToMidi(data.note) + deltaMidi) },
              true,
              data
            );
          else note.note = this.midiToNoteName(this.noteNameToMidi(note.note) + deltaMidi);
          target.note = this.midiToNoteName(this.noteNameToMidi(data.note) + deltaMidi);
        }
        nextSelection.add(this.gridCellKey(target));
      }
      if (data.gridKind === 'sequencer' && (key === 'ArrowRight' || key === 'ArrowLeft')) {
        const deltaSteps = key === 'ArrowRight' ? 1 : -1;
        const target = {
          ...data,
          stepIndex: String(Math.max(0, Number(data.stepIndex) + deltaSteps)),
        };
        this.writeGridCell(target, true, data);
        if (!modifiers.copy) this.writeGridCell(data, false);
        nextSelection.add(this.gridCellKey(target));
      }
      if (data.gridKind === 'ocra' && (key === 'ArrowRight' || key === 'ArrowLeft')) {
        const delta = key === 'ArrowRight' ? 1 : -1;
        const target = { ...data, colIndex: String(Math.max(0, Number(data.colIndex) + delta)) };
        this.writeGridCell(target, true, data);
        if (!modifiers.copy) this.writeGridCell(data, false);
        nextSelection.add(this.gridCellKey(target));
      }
    }
    this.gridSelection = nextSelection;
    this.logText(
      `grid keyboard edit: ${key}${modifiers.shift ? ' shift' : ''}${modifiers.copy ? ' copy' : ''}`
    );
    this.renderWorkspaceView();
    this.publishProjectChange('grid-keyboard-edit');
  }

  readGridCellState(data = {}) {
    const module = this.patchBay.modules.get(data.moduleId);
    if (!module) return false;
    if (data.gridKind === 'piano') {
      const stepResolution = module.stepResolutionBeats || 0.25;
      return module.notes?.some(
        (note) =>
          note.note === data.note && Math.round(note.beat / stepResolution) === Number(data.step)
      );
    }
    if (data.gridKind === 'sequencer') {
      const row = module.rows?.find((candidate) => candidate.id === data.rowId);
      return Boolean(row?.steps?.[Number(data.stepIndex)]?.enabled);
    }
    if (data.gridKind === 'ocra')
      return (module.grid?.[Number(data.rowIndex)]?.[Number(data.colIndex)] || '.') !== '.';
    return false;
  }

  writeGridCell(data = {}, enabled = true, source = null) {
    const module = this.patchBay.modules.get(data.moduleId);
    if (!module) return;
    if (data.gridKind === 'piano') {
      const stepResolution = module.stepResolutionBeats || 0.25;
      const step = Number(data.step);
      const existing = module.notes?.findIndex(
        (note) => note.note === data.note && Math.round(note.beat / stepResolution) === step
      );
      if (!enabled && existing >= 0) module.notes.splice(existing, 1);
      if (enabled && existing < 0) {
        const template =
          source?.gridKind === 'piano'
            ? module.notes?.find(
                (note) =>
                  note.note === source.note &&
                  Math.round(note.beat / stepResolution) === Number(source.step)
              )
            : null;
        module.notes = module.notes || [];
        module.notes.push({
          id: `note-${Date.now()}-${module.notes.length}`,
          kind: PortType.MIDI,
          type: 'note-on',
          beat: step * stepResolution,
          note: data.note,
          velocity: template?.velocity ?? 0.8,
          duration: template?.duration ?? stepResolution * 2,
        });
        module.notes.sort((a, b) => a.beat - b.beat || a.note.localeCompare(b.note));
      }
      module.render?.();
      return;
    }
    if (data.gridKind === 'sequencer') {
      const stepIndex = Number(data.stepIndex);
      const templateRow =
        source?.gridKind === 'sequencer'
          ? module.rows?.find((candidate) => candidate.id === source.rowId)
          : null;
      const template = templateRow?.steps?.[Number(source?.stepIndex)];
      module.setStep?.(data.rowId, stepIndex, { ...(template || {}), enabled });
      return;
    }
    if (data.gridKind === 'ocra') {
      const row = Number(data.rowIndex);
      const col = Number(data.colIndex);
      if (!module.grid?.[row]) return;
      const sourceChar =
        source?.gridKind === 'ocra'
          ? module.grid?.[Number(source.rowIndex)]?.[Number(source.colIndex)]
          : null;
      module.grid[row][col] = enabled ? (sourceChar && sourceChar !== '.' ? sourceChar : 'D') : '.';
      module.renderGrid?.(null);
    }
  }

  applyGridDragCell(data) {
    if (!this.gridDrag) return;
    const key = this.gridCellKey(data);
    if (this.gridDrag.seen.has(key)) return;
    this.gridDrag.seen.add(key);
    this.selectGridCell(data, { append: true, selected: true });
    if (this.gridDrag.append) return;
    this.writeGridCell(
      data,
      this.gridDrag.targetState,
      this.gridDrag.copy ? this.gridDrag.source : null
    );
  }

  duplicateGridSelection() {
    const parsed = [...this.gridSelection].map((key) => {
      const [gridKind, moduleId, rowOrNote, step] = key.split(':');
      return {
        gridKind,
        moduleId,
        rowId: rowOrNote,
        note: rowOrNote,
        rowIndex: rowOrNote,
        stepIndex: step,
        step,
        colIndex: step,
      };
    });
    for (const data of parsed) {
      const target = { ...data };
      if (data.gridKind === 'piano') target.step = String(Number(data.step) + 1);
      if (data.gridKind === 'sequencer') target.stepIndex = String(Number(data.stepIndex) + 1);
      if (data.gridKind === 'ocra') target.colIndex = String(Number(data.colIndex) + 1);
      this.writeGridCell(target, true, data);
      this.selectGridCell(target, { append: true, selected: true });
    }
    this.logText(`duplicated ${parsed.length} grid cells`);
    this.renderWorkspaceView();
    this.publishProjectChange('grid-duplicate');
  }

  setWorkspaceView(view) {
    this.workspaceView = view || 'session';
    document.querySelectorAll('[data-workspace-view]').forEach((button) => {
      const active = button.dataset.workspaceView === this.workspaceView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    this.workspacePreferences.saveWorkspaceView(this.workspaceView);
    this.refreshFocusedModuleCard();
    this.renderWorkspaceView();
  }

  refreshFocusedModuleCard() {
    this.modulesEl?.querySelectorAll('.module-card').forEach((card) => {
      card.classList.toggle('focused-module', card.dataset.moduleId === this.focusedModuleId);
    });
  }

  openSignalFlowForModule(moduleId) {
    const chain = this.detectSignalChains().find((ids) => ids.includes(moduleId));
    this.selectedChainId = chain?.join('>') || null;
    this.refreshModuleChainBadges();
    this.setWorkspaceView('chains');
  }

  restoreWorkspaceView() {
    const saved = this.workspacePreferences.restoreWorkspaceView();
    if (saved) this.setWorkspaceView(saved);
  }

  restoreDrawerStates() {
    const drawers = [...document.querySelectorAll('.sidebar-drawer')];
    this.workspacePreferences.restoreDrawerStates(drawers);
    drawers.forEach((drawer) => {
      drawer.addEventListener('toggle', () => this.saveDrawerStates());
    });
  }

  saveDrawerStates() {
    this.workspacePreferences.saveDrawerStates([...document.querySelectorAll('.sidebar-drawer')]);
  }

  scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.renderWorkspaceView();
    });
  }

  workspaceModules() {
    return selectWorkspaceModules(this.patchBay.modules);
  }

  clipCapableModules() {
    return selectClipCapableModules(this.workspaceModules());
  }

  chainForModule(moduleId) {
    return this.detectSignalChains().find((chain) => chain.includes(moduleId)) || [];
  }

  chainSummaryForModule(moduleId) {
    const chain = this.chainForModule(moduleId);
    if (!chain.length) return 'unpatched chain';
    const modules = chain.map((id) => this.patchBay.modules.get(id)).filter(Boolean);
    if (!modules.length) return 'unpatched chain';
    return modules.map((module) => module.title).join(' → ');
  }

  chainIdForModule(moduleId) {
    const chain = this.chainForModule(moduleId);
    return chain.length ? chain.join('>') : null;
  }

  chainDisplayName(chain) {
    const modules = chain.map((id) => this.patchBay.modules.get(id)).filter(Boolean);
    if (!modules.length) return 'Unpatched Chain';
    const haystack = modules
      .map((module) => `${module.title} ${module.kind}`)
      .join(' ')
      .toLowerCase();
    if (haystack.includes('drum')) return 'Drum Chain';
    if (haystack.includes('bass')) return 'Bass Chain';
    if (haystack.includes('chord') || haystack.includes('key') || haystack.includes('rhodes'))
      return 'Keys Chain';
    if (haystack.includes('sample')) return 'Sampler Chain';
    return `${modules[0].title} Chain`;
  }

  moduleChainBadgeHtml(module) {
    const chain = this.chainForModule(module?.id);
    const chainId = chain.length ? chain.join('>') : '';
    const label = chain.length ? this.chainDisplayName(chain) : 'Unpatched';
    const selected = chainId && chainId === this.selectedChainId;
    return `<div class="module-chain-badge ${selected ? 'selected-chain-module' : ''}" data-chain-module-id="${this.escapeHtml(module?.id || '')}" data-chain-id="${this.escapeHtml(chainId)}"><span>Chain: ${this.escapeHtml(label)}</span><button type="button" data-chain-action="view-chain" data-module-id="${this.escapeHtml(module?.id || '')}">View Chain</button></div>`;
  }

  refreshModuleChainBadges() {
    for (const card of this.modulesEl?.querySelectorAll?.('[data-module-id]') || []) {
      const module = this.patchBay.modules.get(card.dataset.moduleId);
      const badge = card.querySelector('.module-chain-badge');
      if (module && badge) badge.outerHTML = this.moduleChainBadgeHtml(module);
      const chainId = this.chainIdForModule(card.dataset.moduleId);
      card.classList.toggle(
        'selected-chain-module',
        Boolean(chainId && chainId === this.selectedChainId)
      );
    }
  }

  moduleEditActionLabel(module) {
    if (!module) return 'OPEN MODULE';
    const haystack =
      `${module.moduleType || ''} ${module.kind || ''} ${module.title || ''}`.toLowerCase();
    if (this.isSamplerModule(module)) return 'EDIT SAMPLES';
    if (haystack.includes('drum')) return 'OPEN PADS';
    if (Array.isArray(module.rows) || Array.isArray(module.steps)) return 'EDIT PATTERN';
    return 'OPEN MODULE';
  }

  moduleOperationalHint(module) {
    if (!module) return 'Open the target module to edit the sound source.';
    const label = this.moduleEditActionLabel(module)
      .replace('OPEN ', '')
      .replace('EDIT ', '')
      .toLowerCase();
    return `This clip plays ${module.title}. Open ${label} to adjust the pattern, pads, samples, or generator controls.`;
  }

  makeClipSlot({ id, moduleId, title, note = 'C4', launchBeat = 0, stopBeat = null } = {}) {
    const slotId = id || `slot-${this.clipSlotSequence++}`;
    const module = this.patchBay.modules.get(moduleId) || this.clipCapableModules()[0];
    const normalizedModuleId = module?.id || moduleId || 'unassigned';
    const clip = new Clip({
      id: `${slotId}-clip`,
      name: title || `${module?.title || 'Clip'} Pattern`,
      channelId: normalizedModuleId,
      lengthBars: 1,
      beatsPerBar: 4,
      midi: [
        { beat: 0, note, velocity: 0.85, duration: 1 },
        { beat: 2, note: note === 'C4' ? 'G4' : note, velocity: 0.65, duration: 1 },
      ],
    });
    const slot = new ClipSlot({
      channelId: normalizedModuleId,
      quantizationBeats: 4,
      clip,
      launchBeat,
      stopBeat,
    });
    slot.id = slotId;
    slot.moduleId = normalizedModuleId;
    slot.name = clip.name;
    return slot;
  }

  ensureDefaultClipSlots({ force = false } = {}) {
    if (this.clipSlots.length && !force) return;
    const capable = this.clipCapableModules();
    this.clipSlotSequence = 1;
    this.clipSlots = capable.slice(0, 4).map((module, index) =>
      this.makeClipSlot({
        id: `slot-${index + 1}`,
        moduleId: module.id,
        title: `${module.title} Clip`,
        note: ['C4', 'D4', 'E4', 'G4'][index] || 'C4',
        launchBeat: index === 0 ? 0 : null,
      })
    );
  }

  serializeMixerState() {
    return serializeMixerStateSnapshot(this.mixerState);
  }

  restoreMixerState(project = {}) {
    const mixer = project.mixer || {};
    this.mixerState = {
      masterVolume: Number(mixer.masterVolume ?? this.mixerState?.masterVolume ?? 0.8),
      channels: { ...(mixer.channels || {}) },
    };
    this.runtime.setMasterVolume?.(this.mixerState.masterVolume);
  }

  serializeClipState() {
    return serializeClipStateSnapshot({ currentBeat: this.currentBeat, clipSlots: this.clipSlots });
  }

  deserializeClipSlot(data = {}) {
    const slot = new ClipSlot({
      channelId: data.channelId || data.moduleId || 'channel-1',
      quantizationBeats: data.quantizationBeats ?? 4,
      clip: data.clip ? new Clip(data.clip) : null,
      launchBeat: data.launchBeat ?? null,
      stopBeat: data.stopBeat ?? null,
    });
    slot.id = data.id || `slot-${this.clipSlotSequence++}`;
    slot.moduleId = data.moduleId || data.channelId || slot.channelId;
    slot.name = data.name || slot.clip?.name || slot.id;
    return slot;
  }

  restoreClipState(project = {}) {
    const clipState = project.clips || {};
    this.currentBeat = Number(clipState.currentBeat ?? project.currentBeat ?? 0);
    this.clipSlots = Array.from(clipState.slots || project.clipSlots || []).map((slot) =>
      this.deserializeClipSlot(slot)
    );
    this.clipSlotSequence = this.clipSlots.length + 1;
    this.arrangement = new Arrangement(
      project.arrangement || { loopStartBeat: 0, loopEndBeat: 16 }
    );
    this.ensureDefaultClipSlots({ force: this.clipSlots.length === 0 });
  }

  handleClipAction(action, slotId) {
    if (action === 'create') return this.createClipSlotForFocusedModule();
    if (action === 'place-all') return this.placeAllClipsOnArrangement();
    if (action === 'clear-arrangement') return this.clearArrangement();
    const slot = this.clipSlots.find((item) => item.id === slotId);
    if (!slot) return null;
    if (action === 'launch') {
      const beat = slot.queueLaunch(slot.clip, this.currentBeat);
      this.logText(`clip launched at beat ${beat}: ${slot.name}`);
    }
    if (action === 'stop') {
      const beat = slot.queueStop(this.currentBeat);
      this.logText(`clip stop queued at beat ${beat}: ${slot.name}`);
    }
    if (action === 'place') this.placeSlotOnArrangement(slot.id);
    if (action === 'delete') {
      this.clipSlots = this.clipSlots.filter((item) => item.id !== slot.id);
      this.logText(`clip slot removed: ${slot.name}`);
    }
    this.renderWorkspaceView();
    this.publishProjectChange(`clip-${action}`);
    return slot;
  }

  createClipSlotForFocusedModule() {
    const focused = this.patchBay.modules.get(this.focusedModuleId) || this.clipCapableModules()[0];
    const slot = this.makeClipSlot({
      moduleId: focused?.id,
      title: `${focused?.title || 'New'} Clip ${this.clipSlotSequence}`,
      launchBeat: null,
    });
    this.clipSlots.push(slot);
    this.logText(`clip slot created: ${slot.name}`);
    this.renderWorkspaceView();
    this.publishProjectChange('clip-created');
    return slot;
  }

  placeSlotOnArrangement(slotId) {
    const slot = this.clipSlots.find((item) => item.id === slotId);
    if (!slot?.clip) return null;
    const startBeat = this.arrangement.clips.length * 4;
    const placement = this.arrangement.placeClip({
      clip: slot.clip,
      startBeat,
      trackId: slot.moduleId || slot.channelId,
    });
    this.logText(`clip placed on arrangement: ${slot.name} @ beat ${startBeat}`);
    return placement;
  }

  placeAllClipsOnArrangement() {
    for (const slot of this.clipSlots) this.placeSlotOnArrangement(slot.id);
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-place-all');
  }

  clearArrangement() {
    this.arrangement = new Arrangement({ loopStartBeat: 0, loopEndBeat: 16 });
    this.logText('arrangement cleared');
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-cleared');
  }

  arrangementLengthBeats() {
    const clipEnd = Math.max(
      0,
      ...this.arrangement.clips.map((placement) => placement.startBeat + placement.clip.lengthBeats)
    );
    return Math.max(16, this.arrangement.loopEndBeat || 0, clipEnd);
  }

  placementByIndex(index) {
    return this.arrangement.clips[Number(index)] || null;
  }

  moveArrangementPlacement(index, delta) {
    const placement = this.placementByIndex(index);
    if (!placement) return;
    placement.startBeat = Math.max(0, Number((placement.startBeat + delta).toFixed(6)));
    this.logText(`arrangement clip moved: ${placement.clip.name} @ beat ${placement.startBeat}`);
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-move');
  }

  duplicateArrangementPlacement(index) {
    const placement = this.placementByIndex(index);
    if (!placement) return;
    const duplicate = this.arrangement.placeClip({
      clip: new Clip({
        ...placement.clip.serialize(),
        id: `${placement.clip.id}-copy-${Date.now()}`,
        name: `${placement.clip.name} Copy`,
      }),
      startBeat: placement.startBeat + placement.clip.lengthBeats,
      trackId: placement.trackId,
    });
    this.logText(`arrangement clip duplicated: ${duplicate.clip.name}`);
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-duplicate');
  }

  deleteArrangementPlacement(index) {
    const placement = this.placementByIndex(index);
    if (!placement) return;
    this.arrangement.clips.splice(Number(index), 1);
    this.logText(`arrangement clip removed: ${placement.clip.name}`);
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-delete');
  }

  setArrangementLoop(startBeat, endBeat) {
    const start = Math.max(0, Number(startBeat));
    const end = Math.max(start + 1, Number(endBeat));
    this.arrangement.loopStartBeat = start;
    this.arrangement.loopEndBeat = end;
    this.logText(`arrangement loop set: ${start}-${end}`);
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-loop');
  }

  previewArrangementBeat(beat) {
    this.currentBeat = this.arrangement.transportPositionAfter(Math.max(0, Number(beat)), {
      loop: true,
    });
    const events = this.arrangement.eventsAt(this.currentBeat);
    this.logText(`arrangement preview beat ${this.currentBeat}: ${events.length} events`);
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-preview');
  }

  handleArrangementAction(action, target) {
    const index = target.dataset.placementIndex;
    if (action === 'move-left') return this.moveArrangementPlacement(index, -1);
    if (action === 'move-right') return this.moveArrangementPlacement(index, 1);
    if (action === 'duplicate') return this.duplicateArrangementPlacement(index);
    if (action === 'delete') return this.deleteArrangementPlacement(index);
    if (action === 'preview')
      return this.previewArrangementBeat(target.dataset.beat ?? this.currentBeat);
    return null;
  }

  handleArrangementPointerDown(event) {
    const clip = event.target.closest('[data-arrangement-clip]');
    if (!clip || event.target.closest('button')) return;
    const index = Number(clip.dataset.placementIndex);
    const placement = this.placementByIndex(index);
    if (!placement) return;
    if (event.altKey) {
      this.deleteArrangementPlacement(index);
      event.preventDefault();
      return;
    }
    let dragIndex = index;
    if (event.ctrlKey || event.metaKey) {
      this.duplicateArrangementPlacement(index);
      dragIndex = this.arrangement.clips.length - 1;
    }
    const track = clip.closest('.timeline-track');
    const rect = track?.getBoundingClientRect();
    const dragPlacement = this.arrangement.clips[dragIndex];
    this.arrangementDrag = {
      index: dragIndex,
      mode: event.target.closest('[data-arrangement-resize]')?.dataset.arrangementResize || 'move',
      startX: event.clientX,
      startBeat: dragPlacement?.startBeat || 0,
      startLengthBars: dragPlacement?.clip?.lengthBars || 1,
      beatsPerBar: dragPlacement?.clip?.beatsPerBar || 4,
      lengthBeats: this.arrangementLengthBeats(),
      rectWidth: Math.max(1, rect?.width || 1),
      snap: event.shiftKey ? 4 : event.altKey ? 0.25 : 1,
      copied: event.ctrlKey || event.metaKey,
    };
    try {
      if (clip.isConnected && typeof clip.setPointerCapture === 'function')
        clip.setPointerCapture(event.pointerId);
    } catch (_) {}
    event.preventDefault();
  }

  handleArrangementPointerMove(event) {
    if (!this.arrangementDrag || event.buttons !== 1) return;
    const placement = this.placementByIndex(this.arrangementDrag.index);
    if (!placement) return;
    const deltaPx = event.clientX - this.arrangementDrag.startX;
    const rawDeltaBeats =
      (deltaPx / this.arrangementDrag.rectWidth) * this.arrangementDrag.lengthBeats;
    const snap = Math.max(0.25, this.arrangementDrag.snap);
    const quantizedDelta = Number((Math.round(rawDeltaBeats / snap) * snap).toFixed(6));
    if (this.arrangementDrag.mode === 'resize-end') {
      const newLengthBeats = Math.max(
        snap,
        this.arrangementDrag.startLengthBars * this.arrangementDrag.beatsPerBar + quantizedDelta
      );
      placement.clip.lengthBars = Math.max(
        0.25,
        Number((newLengthBeats / this.arrangementDrag.beatsPerBar).toFixed(6))
      );
    } else if (this.arrangementDrag.mode === 'resize-start') {
      const newStart = Math.max(
        0,
        Number((this.arrangementDrag.startBeat + quantizedDelta).toFixed(6))
      );
      const oldEnd =
        this.arrangementDrag.startBeat +
        this.arrangementDrag.startLengthBars * this.arrangementDrag.beatsPerBar;
      placement.startBeat = Math.min(newStart, Math.max(0, oldEnd - snap));
      placement.clip.lengthBars = Math.max(
        0.25,
        Number(((oldEnd - placement.startBeat) / this.arrangementDrag.beatsPerBar).toFixed(6))
      );
    } else {
      placement.startBeat = Math.max(
        0,
        Number(
          (Math.round((this.arrangementDrag.startBeat + rawDeltaBeats) / snap) * snap).toFixed(6)
        )
      );
    }
    const clipEl = document.querySelector(
      `[data-arrangement-clip][data-placement-index="${CSS.escape(String(this.arrangementDrag.index))}"]`
    );
    if (clipEl) {
      clipEl.style.left = `${Math.min(94, (placement.startBeat / this.arrangementDrag.lengthBeats) * 100)}%`;
      clipEl.style.width = `${Math.max(8, (placement.clip.lengthBeats / this.arrangementDrag.lengthBeats) * 100)}%`;
    }
  }

  endArrangementDrag() {
    if (!this.arrangementDrag) return;
    const placement = this.placementByIndex(this.arrangementDrag.index);
    if (placement)
      this.logText(
        `arrangement clip ${this.arrangementDrag.mode === 'move' ? (this.arrangementDrag.copied ? 'copied' : 'dragged') : 'resized'}: ${placement.clip.name} @ beat ${placement.startBeat} len ${placement.clip.lengthBeats}`
      );
    this.arrangementDrag = null;
    this.renderWorkspaceView();
    this.publishProjectChange('arrangement-drag');
  }

  renderArrangementEditor() {
    const placements = this.arrangement.clips;
    const tracks = [...new Set(placements.map((placement) => placement.trackId))];
    const lanes = tracks.length
      ? tracks
      : this.clipCapableModules()
          .slice(0, 4)
          .map((module) => module.id);
    const length = this.arrangementLengthBeats();
    const playheadPct = Math.min(98, Math.max(0, (this.currentBeat / length) * 100));
    const laneMarkup = lanes
      .map((trackId) => {
        const module = this.patchBay.modules.get(trackId);
        const trackClips = placements
          .map((placement, index) => ({ ...placement, index }))
          .filter((placement) => placement.trackId === trackId);
        return `<div class="timeline-lane arrangement-lane"><strong>${this.escapeHtml(module?.title || trackId)}</strong><div class="timeline-track"><span class="timeline-playhead" style="left:${playheadPct}%"></span>${trackClips.map((placement) => `<span class="timeline-clip editable" data-arrangement-clip="true" data-placement-index="${placement.index}" style="left:${Math.min(94, (placement.startBeat / length) * 100)}%;width:${Math.max(8, (placement.clip.lengthBeats / length) * 100)}%"><i class="clip-resize-handle left" data-arrangement-resize="resize-start" title="drag to trim start"></i><strong>${this.escapeHtml(placement.clip.name)}</strong><small>@${this.escapeHtml(placement.startBeat)} · ${this.escapeHtml(placement.clip.lengthBeats)}b</small><i class="clip-resize-handle right" data-arrangement-resize="resize-end" title="drag to resize end"></i><span class="clip-actions"><button type="button" data-arrangement-action="move-left" data-placement-index="${placement.index}">◀</button><button type="button" data-arrangement-action="move-right" data-placement-index="${placement.index}">▶</button><button type="button" data-arrangement-action="duplicate" data-placement-index="${placement.index}">DUP</button><button type="button" data-arrangement-action="delete" data-placement-index="${placement.index}">×</button></span></span>`).join('')}</div></div>`;
      })
      .join('');
    return `<div class="workspace-toolbar arrangement-toolbar"><button type="button" data-clip-action="place-all">PLACE ALL CLIPS</button><button type="button" data-clip-action="clear-arrangement">CLEAR</button><label>Loop start <input data-arrangement-input="loop-start" type="number" min="0" step="1" value="${this.escapeHtml(this.arrangement.loopStartBeat)}"></label><label>Loop end <input data-arrangement-input="loop-end" type="number" min="1" step="1" value="${this.escapeHtml(this.arrangement.loopEndBeat)}"></label><label>Preview beat <input data-arrangement-input="preview-beat" type="number" min="0" step="1" value="${this.escapeHtml(this.currentBeat)}"></label><button type="button" data-arrangement-action="preview" data-beat="${this.escapeHtml(this.currentBeat)}">PREVIEW</button><span class="microcopy">${placements.length} placements · loop ${this.arrangement.loopStartBeat}-${this.arrangement.loopEndBeat} · ${this.arrangement.eventsAt(this.currentBeat).length} events now</span></div>${laneMarkup}<p class="microcopy">Arrangement editing is backed by Arrangement.placeClip(), eventsAt(), and transportPositionAfter(). Drag clip body to move, Ctrl/Cmd-drag to copy, drag edges to resize, Shift for 4-beat snap, Alt for fine 1/4-beat snap/delete.</p>`;
  }

  noteNames(module = null) {
    const base = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3', 'G3', 'F3'];
    const actual = Array.from(
      new Set((module?.notes || []).map((note) => note.note).filter(Boolean))
    );
    return [...actual.filter((note) => !base.includes(note)), ...base];
  }

  renderPianoRollEditor(module) {
    const notes = Array.isArray(module.notes) ? module.notes : [];
    const noteNames = this.noteNames(module);
    const steps = Math.max(
      8,
      Math.min(
        64,
        module.steps || Math.ceil((module.lengthBeats || 4) / (module.stepResolutionBeats || 0.25))
      )
    );
    const cells = noteNames
      .map(
        (noteName) => `
      <div class="piano-note-label">${this.escapeHtml(noteName)}</div>
      ${Array.from({ length: steps }, (_, step) => {
        const hasNote = notes.some(
          (note) =>
            note.note === noteName && Math.round(note.beat / module.stepResolutionBeats) === step
        );
        const selected = this.gridCellSelected({
          gridKind: 'piano',
          moduleId: module.id,
          note: noteName,
          step,
        });
        return `<button type="button" class="piano-cell ${hasNote ? 'on' : ''} ${selected ? 'selected' : ''}" data-grid-cell="piano" data-grid-kind="piano" data-module-action="toggle-note" data-module-id="${this.escapeHtml(module.id)}" data-note="${this.escapeHtml(noteName)}" data-step="${step}" title="${this.escapeHtml(noteName)} step ${step + 1}">${hasNote ? '●' : ''}</button>`;
      }).join('')}
    `
      )
      .join('');
    const noteRows = notes
      .map(
        (note) =>
          `<div class="workspace-row"><strong>${this.escapeHtml(note.note)}</strong><span>beat ${this.escapeHtml(note.beat)}</span><label>Velocity <input data-module-input="note-velocity" data-module-id="${this.escapeHtml(module.id)}" data-note-id="${this.escapeHtml(note.id)}" type="range" min="0" max="1" step="0.01" value="${this.escapeHtml(note.velocity)}"></label></div>`
      )
      .join('');
    return `<div class="piano-roll-editor"><div class="workspace-toolbar"><button type="button" data-module-action="add-note" data-module-id="${this.escapeHtml(module.id)}">ADD NOTE</button><button type="button" data-module-action="clear-notes" data-module-id="${this.escapeHtml(module.id)}">CLEAR NOTES</button><button type="button" data-module-action="apply-swing" data-module-id="${this.escapeHtml(module.id)}">APPLY SWING</button><span class="microcopy">${notes.length} notes · ${steps} steps · click/drag paint · Shift select · Ctrl/Cmd+D duplicate · arrows move · Shift+arrows length/velocity · Delete erase</span></div><div class="piano-grid" style="--steps:${steps}">${cells}</div><div class="workspace-list">${noteRows || '<p class="microcopy">No notes yet. Click grid cells or ADD NOTE.</p>'}</div></div>`;
  }

  ensureMixerChannel(module) {
    const existing = this.mixerState.channels[module.id];
    if (existing) return existing;
    const state = {
      id: module.id,
      title: module.title,
      gain: Number(module.gainValue ?? module.output?.gain?.value ?? 0.8),
      pan: Number(module.panValue ?? 0),
      muted: Boolean(module.muted ?? false),
      solo: false,
    };
    this.mixerState.channels[module.id] = state;
    return state;
  }

  mixerModules() {
    return selectMixerModules(this.workspaceModules(), { mixer: this.mixer });
  }

  isSamplerModule(module) {
    return selectIsSamplerModule(module);
  }

  ensureWaveformEdit(module) {
    module.waveformEdit = module.waveformEdit || {
      trimStartMs: 0,
      trimEndMs:
        module.sampleMetadata?.sampleLengthMs ||
        (module.buffer ? Math.round(module.buffer.duration * 1000) : 0),
      fadeInMs: 0,
      fadeOutMs: 0,
      gain: 1,
      reverse: false,
      normalized: false,
    };
    return module.waveformEdit;
  }

  renderWaveformEditPanel(module) {
    const edit = this.ensureWaveformEdit(module);
    const length =
      module.sampleMetadata?.sampleLengthMs ||
      (module.buffer ? Math.round(module.buffer.duration * 1000) : 0);
    return `<article class="workspace-card module-editor-card waveform-edit-panel"><strong>Waveform / buffer edit</strong>${this.renderSamplerWaveformPreview(module)}<label>Trim start ms <input data-module-input="waveform-edit" data-module-id="${this.escapeHtml(module.id)}" data-waveform-key="trimStartMs" type="number" min="0" step="1" value="${this.escapeHtml(edit.trimStartMs)}"></label><label>Trim end ms <input data-module-input="waveform-edit" data-module-id="${this.escapeHtml(module.id)}" data-waveform-key="trimEndMs" type="number" min="0" step="1" value="${this.escapeHtml(edit.trimEndMs || length)}"></label><label>Fade in ms <input data-module-input="waveform-edit" data-module-id="${this.escapeHtml(module.id)}" data-waveform-key="fadeInMs" type="number" min="0" step="1" value="${this.escapeHtml(edit.fadeInMs)}"></label><label>Fade out ms <input data-module-input="waveform-edit" data-module-id="${this.escapeHtml(module.id)}" data-waveform-key="fadeOutMs" type="number" min="0" step="1" value="${this.escapeHtml(edit.fadeOutMs)}"></label><label>Gain <input data-module-input="waveform-edit" data-module-id="${this.escapeHtml(module.id)}" data-waveform-key="gain" type="range" min="0" max="2" step="0.01" value="${this.escapeHtml(edit.gain)}"></label><div class="button-row"><button type="button" data-module-action="waveform-normalize" data-module-id="${this.escapeHtml(module.id)}">NORMALIZE</button><button type="button" data-module-action="waveform-reverse" data-module-id="${this.escapeHtml(module.id)}">${edit.reverse ? 'UNREVERSE' : 'REVERSE'}</button><button type="button" data-module-action="waveform-apply-take" data-module-id="${this.escapeHtml(module.id)}">APPLY AS TAKE</button></div><p class="microcopy">Non-destructive edit metadata: ${this.escapeHtml(edit.trimStartMs)}-${this.escapeHtml(edit.trimEndMs || length)} ms · gain ${this.escapeHtml(edit.gain)} · ${edit.reverse ? 'reversed' : 'forward'}${edit.normalized ? ' · normalized' : ''}</p></article>`;
  }

  renderSamplerWaveformPreview(module) {
    if (typeof module.renderWaveform === 'function') return module.renderWaveform(64);
    return '<p class="microcopy">No waveform available yet. Load audio in the compact module card to render peaks.</p>';
  }

  renderCleanSamplerEditor(module) {
    const metadata = module.sampleMetadata || {};
    const cues = metadata.cues || [];
    return `<div class="sampler-editor"><article class="workspace-card module-editor-card"><strong>Sample</strong><span class="big-number sampler-file-name">${this.escapeHtml(module.fileName || 'no sample')}</span>${this.renderSamplerWaveformPreview(module)}<div class="button-row"><button type="button" data-module-action="sampler-play" data-module-id="${this.escapeHtml(module.id)}">PLAY ${this.escapeHtml(module.rootNote || 'C4')}</button><button type="button" data-module-action="sampler-sync-library" data-module-id="${this.escapeHtml(module.id)}">SYNC LIBRARY</button></div></article>${this.renderWaveformEditPanel(module)}<article class="workspace-card module-editor-card"><strong>Pitch/time</strong><label>Root note <input data-module-input="sampler-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="rootNote" type="text" value="${this.escapeHtml(module.rootNote || 'C4')}"></label><label>Time shift <input data-module-input="sampler-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="timeShift" type="number" min="0" step="0.01" value="${this.escapeHtml(module.timeShift ?? 0)}"></label><label>Stretch <input data-module-input="sampler-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="stretchRatio" type="range" min="0.25" max="4" step="0.01" value="${this.escapeHtml(module.stretchRatio ?? 1)}"></label><label>Pitch semitones <input data-module-input="sampler-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="pitchSemitones" type="range" min="-48" max="48" step="1" value="${this.escapeHtml(module.pitchSemitones ?? 0)}"></label><label>Pitch cents <input data-module-input="sampler-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="pitchCents" type="range" min="-100" max="100" step="1" value="${this.escapeHtml(module.pitchCents ?? 0)}"></label></article><article class="workspace-card module-editor-card"><strong>Envelope</strong>${['attack', 'decay', 'sustain', 'release'].map((key) => `<label>${key.toUpperCase()} <input data-module-input="sampler-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="${key}" type="range" min="${key === 'sustain' ? 0 : 0.001}" max="${key === 'sustain' ? 1 : 4}" step="0.001" value="${this.escapeHtml(module[key] ?? 0)}"></label>`).join('')}</article><article class="workspace-card module-editor-card"><strong>Metadata</strong><label>BPM <input data-module-input="sampler-meta" data-module-id="${this.escapeHtml(module.id)}" data-meta-key="bpm" type="number" min="1" max="400" step="0.01" value="${this.escapeHtml(metadata.bpm || '')}"></label><label>Tags <input data-module-input="sampler-meta" data-module-id="${this.escapeHtml(module.id)}" data-meta-key="tags" type="text" value="${this.escapeHtml((metadata.tags || []).join(', '))}"></label><label>Creator <input data-module-input="sampler-meta" data-module-id="${this.escapeHtml(module.id)}" data-meta-key="creator" type="text" value="${this.escapeHtml(metadata.creator || '')}"></label><label>Instrument <input data-module-input="sampler-meta" data-module-id="${this.escapeHtml(module.id)}" data-meta-key="instrument" type="text" value="${this.escapeHtml(metadata.instrument || '')}"></label><label>Song <input data-module-input="sampler-meta" data-module-id="${this.escapeHtml(module.id)}" data-meta-key="songTitle" type="text" value="${this.escapeHtml(metadata.songTitle || '')}"></label><div class="button-row"><button type="button" data-module-action="sampler-add-cue" data-module-id="${this.escapeHtml(module.id)}">ADD CUE</button><button type="button" data-module-action="sampler-gen-cues" data-module-id="${this.escapeHtml(module.id)}">GEN 4 CUES</button></div><p class="microcopy">${cues.length} cues · ${this.escapeHtml(metadata.sampleLengthMs || 0)} ms</p></article></div>`;
  }

  renderDrumSamplerEditor(module) {
    const pads = [...(module.pads?.values?.() || [])];
    const loadedCount = pads.filter((pad) => pad.buffer).length;
    return `<div class="sampler-editor"><article class="workspace-card module-editor-card"><strong>Drum pad setup</strong><span class="drum-pad-summary">${loadedCount}/${pads.length} pads have samples assigned</span><label>Swing <select data-module-input="drum-swing" data-module-id="${this.escapeHtml(module.id)}">${['swing50', 'swing54', 'swing57', 'swing60', 'swing62', 'swing66', 'swing75', 'swing90'].map((value) => `<option value="${value}" ${value === module.swing ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Resolution <select data-module-input="drum-resolution" data-module-id="${this.escapeHtml(module.id)}">${['1/4', '1/8', '1/16'].map((value) => `<option value="${value}" ${value === module.swingResolution ? 'selected' : ''}>${value}</option>`).join('')}</select></label></article><div class="drum-pad-editor-grid">${pads.map((pad) => `<article class="workspace-card module-editor-card drum-pad-editor ${pad.buffer ? 'drum-pad-loaded' : 'drum-pad-empty'}"><div class="drum-pad-header"><strong>${this.escapeHtml(pad.id)}</strong><span class="drum-pad-status-badge ${pad.buffer ? 'badge-loaded' : 'badge-empty'}">${pad.buffer ? 'LOADED' : 'EMPTY'}</span></div><div class="drum-pad-sample-info">${pad.buffer ? `<span class="drum-pad-file-name">${this.escapeHtml(pad.fileName || 'unnamed sample')}</span>` : `<span class="drum-pad-drop-hint">drop audio file or use button below</span>`}</div><label>Name <input data-module-input="drum-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-id="${this.escapeHtml(pad.id)}" data-pad-key="name" type="text" value="${this.escapeHtml(pad.name)}"></label><label>Note <input data-module-input="drum-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-id="${this.escapeHtml(pad.id)}" data-pad-key="note" type="text" value="${this.escapeHtml(pad.note)}"></label><label>Gain <input data-module-input="drum-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-id="${this.escapeHtml(pad.id)}" data-pad-key="gain" type="range" min="0" max="2" step="0.01" value="${this.escapeHtml(pad.gain)}"></label><label>Pan <input data-module-input="drum-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-id="${this.escapeHtml(pad.id)}" data-pad-key="pan" type="range" min="-1" max="1" step="0.01" value="${this.escapeHtml(pad.pan)}"></label><label>Choke <input data-module-input="drum-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-id="${this.escapeHtml(pad.id)}" data-pad-key="chokeGroup" type="text" value="${this.escapeHtml(pad.chokeGroup || '')}"></label><div class="drum-pad-actions"><button type="button" data-module-action="drum-trigger-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-note="${this.escapeHtml(pad.note)}">TRIGGER</button><label class="drum-pad-upload-label"><input type="file" accept="audio/*" class="drum-pad-file-input" data-module-action="drum-load-pad-file" data-module-id="${this.escapeHtml(module.id)}" data-pad-id="${this.escapeHtml(pad.id)}">LOAD SAMPLE</label></div></article>`).join('')}</div></div>`;
  }

  renderMultiSamplerEditor(module) {
    const zones = module.zones || [];
    return `<div class="sampler-editor"><article class="workspace-card module-editor-card"><strong>Multisampler zones</strong><span class="big-number">${zones.length}</span><label>Slices <input data-module-input="multisampler-slices" data-module-id="${this.escapeHtml(module.id)}" type="number" min="1" max="64" step="1" value="${this.escapeHtml(module.sliceCount || 8)}"></label><div class="button-row"><button type="button" data-module-action="multisampler-add-zone" data-module-id="${this.escapeHtml(module.id)}">ADD EMPTY ZONE</button><button type="button" data-module-action="multisampler-preview-slice" data-module-id="${this.escapeHtml(module.id)}">PREVIEW SLICE</button></div><p class="microcopy">Audio buffers load from compact card; this editor manages persistent zone metadata and slices.</p></article><div class="workspace-list">${zones.map((zone, index) => `<article class="workspace-card module-editor-card"><strong>${this.escapeHtml(zone.name || `zone ${index + 1}`)}</strong><label>Name <input data-module-input="multisampler-zone" data-module-id="${this.escapeHtml(module.id)}" data-zone-index="${index}" data-zone-key="name" type="text" value="${this.escapeHtml(zone.name || '')}"></label><label>Root <input data-module-input="multisampler-zone" data-module-id="${this.escapeHtml(module.id)}" data-zone-index="${index}" data-zone-key="rootNote" type="text" value="${this.escapeHtml(zone.rootNote || 'C4')}"></label><label>Min <input data-module-input="multisampler-zone" data-module-id="${this.escapeHtml(module.id)}" data-zone-index="${index}" data-zone-key="min" type="text" value="${this.escapeHtml(module.noteName?.(zone.min) || 'C1')}"></label><label>Max <input data-module-input="multisampler-zone" data-module-id="${this.escapeHtml(module.id)}" data-zone-index="${index}" data-zone-key="max" type="text" value="${this.escapeHtml(module.noteName?.(zone.max) || 'C7')}"></label></article>`).join('') || '<p class="microcopy">No zones yet. Add empty zone metadata here or load audio files in the compact card.</p>'}</div></div>`;
  }

  renderSamplerEditor(module) {
    const inspector = `<div class="module-focus module-editor"><article class="workspace-card module-editor-card"><strong>${this.escapeHtml(module.title)}</strong><p class="microcopy">${this.escapeHtml(module.kind)} · ${this.escapeHtml(module.id)}</p>${this.renderModulePorts(module)}</article><article class="workspace-card module-editor-card"><strong>Sample editor coverage</strong><p class="microcopy">Full-pane sampler editor started. Waveforms, pads, metadata and zones use existing sampler module APIs.</p></article></div>`;
    if (module.pads instanceof Map) return inspector + this.renderDrumSamplerEditor(module);
    if (Array.isArray(module.zones) || module.sliceCount !== undefined)
      return inspector + this.renderMultiSamplerEditor(module);
    return inspector + this.renderCleanSamplerEditor(module);
  }

  isPatternModule(module) {
    return selectIsPatternModule(module);
  }

  renderSequencerPatternEditor(module) {
    const rows = module.rows || [];
    return `<div class="pattern-editor"><article class="workspace-card module-editor-card"><strong>Step sequencer pattern</strong><label>Length <select data-module-input="sequencer-length" data-module-id="${this.escapeHtml(module.id)}">${[4, 8, 16].map((value) => `<option value="${value}" ${value === module.length ? 'selected' : ''}>${value}</option>`).join('')}</select></label><button type="button" data-module-action="sequencer-convert" data-module-id="${this.escapeHtml(module.id)}">CONVERT TO PIANO ROLL</button><p class="microcopy">${rows.length} rows · ${module.length || 16} steps · editable velocity/micro timing</p></article><div class="pattern-grid">${rows
      .map(
        (row) =>
          `<div class="pattern-row"><strong>${this.escapeHtml(row.label || row.id)}</strong><span class="pill">${this.escapeHtml(row.note)}</span>${row.steps
            .map((step, index) => {
              const selected = this.gridCellSelected({
                gridKind: 'sequencer',
                moduleId: module.id,
                rowId: row.id,
                stepIndex: index,
              });
              return `<button type="button" class="pattern-step ${step.enabled ? 'on' : ''} ${selected ? 'selected' : ''}" data-grid-cell="sequencer" data-grid-kind="sequencer" data-module-action="sequencer-toggle-step" data-module-id="${this.escapeHtml(module.id)}" data-row-id="${this.escapeHtml(row.id)}" data-step-index="${index}">${step.enabled ? '◆' : '·'}</button>`;
            })
            .join('')}</div>`
      )
      .join(
        ''
      )}</div><div class="workspace-list">${rows.map((row) => `<article class="workspace-card module-editor-card"><strong>${this.escapeHtml(row.label || row.id)} controls</strong><label>Step 1 velocity <input data-module-input="sequencer-velocity" data-module-id="${this.escapeHtml(module.id)}" data-row-id="${this.escapeHtml(row.id)}" data-step-index="0" type="range" min="0" max="1" step="0.01" value="${this.escapeHtml(row.steps[0]?.velocity ?? 0.8)}"></label><label>Step 1 micro <input data-module-input="sequencer-micro" data-module-id="${this.escapeHtml(module.id)}" data-row-id="${this.escapeHtml(row.id)}" data-step-index="0" type="range" min="-0.5" max="0.5" step="0.01" value="${this.escapeHtml(row.steps[0]?.microTiming ?? 0)}"></label></article>`).join('')}</div></div>`;
  }

  renderOcraPatternEditor(module) {
    const rows = module.grid || [];
    return `<div class="pattern-editor"><article class="workspace-card module-editor-card"><strong>OCRA grid editor</strong><div class="button-row"><button type="button" data-module-action="ocra-clear" data-module-id="${this.escapeHtml(module.id)}">CLEAR</button><button type="button" data-module-action="ocra-basic-pulse" data-module-id="${this.escapeHtml(module.id)}">BASIC PULSE</button><button type="button" data-module-action="ocra-step" data-module-id="${this.escapeHtml(module.id)}">RUN FRAME</button></div><p class="microcopy">Edit cells as ORCA text rows. Row mixer controls remain in the compact card.</p></article><div class="ocra-text-grid">${rows.map((row, rowIndex) => `<label>R${String(rowIndex).padStart(2, '0')} <input data-module-input="ocra-row" data-module-id="${this.escapeHtml(module.id)}" data-row-index="${rowIndex}" type="text" maxlength="32" value="${this.escapeHtml(row.join ? row.join('') : String(row))}"></label>`).join('')}</div><div class="ocra-cell-grid">${rows
      .map(
        (row, rowIndex) =>
          `<div class="ocra-cell-row"><strong>R${String(rowIndex).padStart(2, '0')}</strong>${Array.from(
            row
          )
            .map((char, colIndex) => {
              const selected = this.gridCellSelected({
                gridKind: 'ocra',
                moduleId: module.id,
                rowIndex,
                colIndex,
              });
              return `<button type="button" class="ocra-cell ${char !== '.' ? 'on' : ''} ${selected ? 'selected' : ''}" data-grid-cell="ocra" data-grid-kind="ocra" data-module-action="ocra-toggle-cell" data-module-id="${this.escapeHtml(module.id)}" data-row-index="${rowIndex}" data-col-index="${colIndex}">${this.escapeHtml(char)}</button>`;
            })
            .join('')}</div>`
      )
      .join('')}</div></div>`;
  }

  renderArpPatternEditor(module) {
    return `<div class="pattern-editor"><article class="workspace-card module-editor-card"><strong>ARP pattern editor</strong><label>Notes <input data-module-input="arp-notes" data-module-id="${this.escapeHtml(module.id)}" type="text" value="${this.escapeHtml((module.notes || []).join(', '))}" placeholder="C3, E3, G3"></label><label>Scale <select data-module-input="arp-param" data-param-key="scale" data-module-id="${this.escapeHtml(module.id)}">${['chromatic', 'major', 'minor'].map((value) => `<option value="${value}" ${value === module.scale ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Interval <select data-module-input="arp-param" data-param-key="interval" data-module-id="${this.escapeHtml(module.id)}">${['scale', 'tritone', 'fifth', 'octave'].map((value) => `<option value="${value}" ${value === module.interval ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Direction <select data-module-input="arp-param" data-param-key="direction" data-module-id="${this.escapeHtml(module.id)}">${['up', 'down'].map((value) => `<option value="${value}" ${value === module.direction ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Octaves <input data-module-input="arp-param" data-param-key="octaves" data-module-id="${this.escapeHtml(module.id)}" type="number" min="1" max="6" value="${this.escapeHtml(module.octaves || 1)}"></label><button type="button" data-module-action="arp-preview" data-module-id="${this.escapeHtml(module.id)}">PREVIEW PATTERN</button></article><article class="workspace-card module-editor-card"><strong>Generated pattern</strong><div class="module-port-grid">${(module.arpPattern?.() || []).map((note) => `<span class="pill">${this.escapeHtml(note)}</span>`).join('') || '<span class="pill">add notes to generate pattern</span>'}</div></article></div>`;
  }

  renderPatternEditor(module) {
    const inspector = `<div class="module-focus module-editor"><article class="workspace-card module-editor-card"><strong>${this.escapeHtml(module.title)}</strong><p class="microcopy">${this.escapeHtml(module.kind)} · ${this.escapeHtml(module.id)}</p>${this.renderModulePorts(module)}</article><article class="workspace-card module-editor-card"><strong>Pattern editor coverage</strong><p class="microcopy">Full-pane OCRA/sequencer/arp editor started. Pattern data uses the module's existing grid/rows/arp APIs.</p></article></div>`;
    if (Array.isArray(module.grid)) return inspector + this.renderOcraPatternEditor(module);
    if (typeof module.arpPattern === 'function')
      return inspector + this.renderArpPatternEditor(module);
    return inspector + this.renderSequencerPatternEditor(module);
  }

  renderFieldRecorderEditor(module) {
    const takes = module.takes || [];
    return `<div class="module-focus module-editor"><article class="workspace-card module-editor-card"><strong>Field take manager</strong><span class="big-number">${takes.length}</span><p class="microcopy">Current file: ${this.escapeHtml(module.fileName || 'no sample loaded')}</p><div class="button-row"><button type="button" data-module-action="field-add-take" data-module-id="${this.escapeHtml(module.id)}">ADD TAKE</button><button type="button" data-module-action="field-play" data-module-id="${this.escapeHtml(module.id)}">PLAY</button><button type="button" data-module-action="field-promote-sample" data-module-id="${this.escapeHtml(module.id)}">PROMOTE SAMPLE</button></div></article>${this.renderWaveformEditPanel(module)}<div class="workspace-list">${takes.map((take, index) => `<article class="workspace-card module-editor-card"><strong>${this.escapeHtml(take.name || `take ${index + 1}`)}</strong><label>Name <input data-module-input="field-take" data-module-id="${this.escapeHtml(module.id)}" data-take-index="${index}" data-take-key="name" type="text" value="${this.escapeHtml(take.name || '')}"></label><label>Start ms <input data-module-input="field-take" data-module-id="${this.escapeHtml(module.id)}" data-take-index="${index}" data-take-key="startMs" type="number" min="0" step="1" value="${this.escapeHtml(take.startMs || 0)}"></label><label>End ms <input data-module-input="field-take" data-module-id="${this.escapeHtml(module.id)}" data-take-index="${index}" data-take-key="endMs" type="number" min="0" step="1" value="${this.escapeHtml(take.endMs || 0)}"></label><button type="button" data-module-action="field-delete-take" data-module-id="${this.escapeHtml(module.id)}" data-take-index="${index}">DELETE TAKE</button></article>`).join('') || '<p class="microcopy">No takes yet. Add a take to start trimming/metadata work.</p>'}</div></div>`;
  }

  renderPeerMonitorEditor(module) {
    const recentPackets = module.packetLog || [];
    const routes = this.patchBay.routes.filter(
      (route) => route.from.moduleId === module.id || route.to.moduleId === module.id
    );
    return `<div class="module-focus module-editor"><article class="workspace-card module-editor-card"><strong>Peer / wiring monitor</strong><p class="microcopy">Status: ${this.escapeHtml(module.status || 'offline')} · lobby ${this.escapeHtml(module.lobbyId || 'n/a')}</p><label>Pilot <input data-module-input="peer-pilot" data-module-id="${this.escapeHtml(module.id)}" type="text" value="${this.escapeHtml(module.lastPilot || 'pilot')}"></label><div class="button-row"><button type="button" data-module-action="peer-connect" data-module-id="${this.escapeHtml(module.id)}">CONNECT</button><button type="button" data-module-action="peer-test-packet" data-module-id="${this.escapeHtml(module.id)}">TEST PACKET</button><button type="button" data-module-action="peer-clear-log" data-module-id="${this.escapeHtml(module.id)}">CLEAR LOG</button></div></article><article class="workspace-card module-editor-card"><strong>Patch routes</strong><div class="route-mini-list">${routes.map((route) => `<span class="pill">${this.escapeHtml(route.from.moduleId)}.${this.escapeHtml(route.from.outputId)} → ${this.escapeHtml(route.to.moduleId)}.${this.escapeHtml(route.to.inputId)}</span>`).join('') || '<span class="pill">no peer routes</span>'}</div></article><article class="workspace-card module-editor-card"><strong>Recent packets</strong><div class="workspace-list">${
      recentPackets
        .slice(-8)
        .map(
          (packet) =>
            `<span class="pill">${this.escapeHtml(packet.kind || packet.type || 'packet')} · ${this.escapeHtml(packet.type || packet.note || packet.value || '')}</span>`
        )
        .join('') || '<span class="pill">no packets yet</span>'
    }</div></article></div>`;
  }

  renderModulePorts(module) {
    const portRows = [
      ...(module.inputs || []).map((port) => ({ ...port, dir: 'in' })),
      ...(module.outputs || []).map((port) => ({ ...port, dir: 'out' })),
    ];
    return `<div class="module-port-grid">${portRows.map((port) => `<span class="pill">${this.escapeHtml(port.dir)} · ${this.escapeHtml(port.id)} · ${this.escapeHtml(port.type)}</span>`).join('') || '<span class="pill">no ports</span>'}</div>`;
  }

  renderClockEditor(module) {
    return `<div class="workspace-card module-editor-card"><strong>Transport controls</strong><label>BPM <input data-module-input="clock-bpm" data-module-id="${this.escapeHtml(module.id)}" type="number" min="40" max="260" step="1" value="${this.escapeHtml(module.bpm || 120)}"></label><p class="microcopy">Updates the focused clock module. Full tap-tempo/groove controls are tracked in MODULE_UI_BACKLOG.</p></div>`;
  }

  synthRange(
    module,
    key,
    { min = 0, max = 1, step = 0.01, label = key, value = module[key] } = {}
  ) {
    return `<label class="control-label"><span>${this.escapeHtml(label)}</span><output data-control-readout>${this.escapeHtml(value ?? 0)}</output><input data-module-input="synth-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="${this.escapeHtml(key)}" type="range" min="${this.escapeHtml(min)}" max="${this.escapeHtml(max)}" step="${this.escapeHtml(step)}" value="${this.escapeHtml(value ?? 0)}" aria-label="${this.escapeHtml(label)}"></label>`;
  }

  synthNumber(
    module,
    key,
    { min = 0, max = 16, step = 0.01, label = key, value = module[key] } = {}
  ) {
    return `<label>${this.escapeHtml(label)} <input data-module-input="synth-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="${this.escapeHtml(key)}" type="number" min="${this.escapeHtml(min)}" max="${this.escapeHtml(max)}" step="${this.escapeHtml(step)}" value="${this.escapeHtml(value ?? 0)}"></label>`;
  }

  renderAdsrPanel(module) {
    const keys = ['attack', 'decay', 'sustain', 'release'].filter((key) => key in module);
    if (!keys.length) return '';
    return `<section class="synth-panel"><strong>Envelope</strong>${keys.map((key) => this.synthRange(module, key, { min: key === 'sustain' ? 0 : 0.001, max: key === 'sustain' ? 1 : 4, step: 0.001, label: key.toUpperCase() })).join('')}</section>`;
  }

  renderSynthEditor(module) {
    const waveforms = ['sine', 'triangle', 'sawtooth', 'square'];
    const waveform = module.waveform || module.oscillatorType || 'triangle';
    const hasOscMix = module.oscillatorMix && typeof module.oscillatorMix === 'object';
    const oscillatorPanel = `<section class="synth-panel"><strong>Oscillator</strong>${'waveform' in module || 'oscillatorType' in module ? `<label>Waveform <select data-module-input="synth-param" data-param-key="waveform" data-module-id="${this.escapeHtml(module.id)}">${waveforms.map((w) => `<option value="${w}" ${w === waveform ? 'selected' : ''}>${w}</option>`).join('')}</select></label>` : ''}${
      hasOscMix
        ? Object.entries(module.oscillatorMix)
            .map(([key, value]) =>
              this.synthRange(module, `oscillatorMix.${key}`, {
                min: 0,
                max: 1.5,
                step: 0.01,
                label: `${key} mix`,
                value,
              })
            )
            .join('')
        : ''
    }${'detuneCents' in module ? this.synthRange(module, 'detuneCents', { min: 0, max: 48, step: 0.1, label: 'Detune cents' }) : ''}</section>`;
    const filterPanel = ['cutoff', 'resonance', 'filterEnvelopeAmount', 'driveAmount'].some(
      (key) => key in module
    )
      ? `<section class="synth-panel"><strong>Filter / Drive</strong>${'cutoff' in module ? this.synthRange(module, 'cutoff', { min: 80, max: 12000, step: 1, label: 'Cutoff' }) : ''}${'resonance' in module ? this.synthRange(module, 'resonance', { min: 0.1, max: 24, step: 0.1, label: 'Resonance' }) : ''}${'filterEnvelopeAmount' in module ? this.synthRange(module, 'filterEnvelopeAmount', { min: 0, max: 6000, step: 1, label: 'Filter env' }) : ''}${'driveAmount' in module ? this.synthRange(module, 'driveAmount', { min: 0, max: 1.5, step: 0.01, label: 'Drive' }) : ''}</section>`
      : '';
    const fmPanel = ['carrierRatio', 'modulatorRatio', 'modulationIndex', 'feedback'].some(
      (key) => key in module
    )
      ? `<section class="synth-panel"><strong>FM operator</strong>${'carrierRatio' in module ? this.synthNumber(module, 'carrierRatio', { min: 0.125, max: 16, step: 0.01, label: 'Carrier ratio' }) : ''}${'modulatorRatio' in module ? this.synthNumber(module, 'modulatorRatio', { min: 0.125, max: 16, step: 0.01, label: 'Mod ratio' }) : ''}${'modulationIndex' in module ? this.synthRange(module, 'modulationIndex', { min: 0, max: 24, step: 0.01, label: 'Index' }) : ''}${'feedback' in module ? this.synthRange(module, 'feedback', { min: 0, max: 1, step: 0.01, label: 'Feedback' }) : ''}</section>`
      : '';
    const wavetablePanel =
      'wavetable' in module
        ? `<section class="synth-panel"><strong>Wavetable</strong><label>Table <select data-module-input="synth-param" data-param-key="wavetable" data-module-id="${this.escapeHtml(module.id)}">${['classic', 'bright', 'hollow', 'glass'].map((name) => `<option value="${name}" ${name === module.wavetable ? 'selected' : ''}>${name}</option>`).join('')}</select></label>${'morph' in module ? this.synthRange(module, 'morph', { min: 0, max: 1, step: 0.01, label: 'Morph' }) : ''}${'tableSize' in module ? this.synthNumber(module, 'tableSize', { min: 8, max: 128, step: 1, label: 'Table size' }) : ''}</section>`
        : '';
    return `<div class="workspace-card module-editor-card synth-editor-card"><strong>Full synth control panel</strong><div class="synth-panel-grid">${oscillatorPanel}${filterPanel}${fmPanel}${wavetablePanel}${this.renderAdsrPanel(module)}</div><div class="button-row"><button type="button" data-module-action="audition-note" data-module-id="${this.escapeHtml(module.id)}">AUDITION C4</button><button type="button" data-module-action="audition-chord" data-module-id="${this.escapeHtml(module.id)}">AUDITION CHORD</button></div><p class="microcopy">Model-backed controls for oscillator, filter, envelope, FM and wavetable parameters where supported by this module.</p></div>`;
  }

  renderEffectEditor(module) {
    const params = Array.isArray(module.params) ? module.params : [];
    return `<div class="workspace-card module-editor-card"><strong>Effect parameters</strong>${params.map((param) => `<label>${this.escapeHtml(param.label || param.key)} <input data-module-input="effect-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="${this.escapeHtml(param.key)}" type="range" min="${this.escapeHtml(param.min)}" max="${this.escapeHtml(param.max)}" step="${this.escapeHtml(param.step || 0.01)}" value="${this.escapeHtml(module[param.key])}"></label>`).join('') || '<p class="microcopy">This module does not expose parameter specs yet.</p>'}<p class="microcopy">Uses the module parameter spec and setParam() when available.</p></div>`;
  }

  renderGenericModuleEditor(module) {
    const incoming = this.patchBay.routes.filter((r) => r.to.moduleId === module.id);
    const outgoing = this.patchBay.routes.filter((r) => r.from.moduleId === module.id);
    const special = [
      module.kind === 'clock' ? this.renderClockEditor(module) : '',
      module.kind?.includes('effect') || Array.isArray(module.params)
        ? this.renderEffectEditor(module)
        : '',
      module.outputs?.some((p) => p.type === PortType.AUDIO) &&
      ('waveform' in module || 'cutoff' in module || typeof module.noteOn === 'function')
        ? this.renderSynthEditor(module)
        : '',
    ]
      .filter(Boolean)
      .join('');
    return `<div class="module-focus module-editor"><article class="workspace-card module-editor-card"><strong>${this.escapeHtml(module.title)}</strong><p class="microcopy">${this.escapeHtml(module.kind)} · ${this.escapeHtml(module.id)}</p>${this.renderModulePorts(module)}</article><article class="workspace-card module-editor-card"><strong>Patch summary</strong><p class="microcopy">Incoming: ${incoming.length} · Outgoing: ${outgoing.length}</p><div class="workspace-list route-mini-list">${[...incoming.map((r) => `← ${r.from.moduleId}.${r.from.outputId}`), ...outgoing.map((r) => `→ ${r.to.moduleId}.${r.to.inputId}`)].map((label) => `<span class="pill">${this.escapeHtml(label)}</span>`).join('') || '<span class="pill">unpatched</span>'}</div></article>${special || '<article class="workspace-card module-editor-card"><strong>Focused editor pending</strong><p class="microcopy">This module currently has the universal inspector. Add a domain editor from docs/MODULE_UI_BACKLOG.md.</p></article>'}</div>`;
  }

  renderMixerEditor() {
    const strips = this.mixerModules();
    const rows = strips
      .map((module) => {
        const channel = this.ensureMixerChannel(module);
        return `<article class="mixer-channel ${channel.muted ? 'muted' : ''} ${channel.solo ? 'solo' : ''}"><strong>${this.escapeHtml(channel.title || module.title)}</strong><small>${this.escapeHtml(module.kind)} · ${this.escapeHtml(module.id)}</small><label class="control-label"><span>Level</span><output data-control-readout>${this.escapeHtml(channel.gain)}</output><input data-module-input="mixer-gain" data-module-id="${this.escapeHtml(module.id)}" type="range" min="0" max="1.5" step="0.01" value="${this.escapeHtml(channel.gain)}" aria-label="${this.escapeHtml(channel.title || module.title)} level"></label><label class="control-label"><span>Pan</span><output data-control-readout>${this.escapeHtml(channel.pan)}</output><input data-module-input="mixer-pan" data-module-id="${this.escapeHtml(module.id)}" type="range" min="-1" max="1" step="0.01" value="${this.escapeHtml(channel.pan)}" aria-label="${this.escapeHtml(channel.title || module.title)} pan"></label><div class="button-row"><button type="button" data-module-action="toggle-mute" data-module-id="${this.escapeHtml(module.id)}">${channel.muted ? 'UNMUTE' : 'MUTE'}</button><button type="button" data-module-action="toggle-solo" data-module-id="${this.escapeHtml(module.id)}">${channel.solo ? 'UNSOLO' : 'SOLO'}</button><button type="button" data-module-action="focus-module" data-module-id="${this.escapeHtml(module.id)}">FOCUS</button></div><span class="pill">${Math.round(channel.gain * 100)}% · pan ${channel.pan.toFixed(2)}</span></article>`;
      })
      .join('');
    return `<div class="workspace-toolbar"><label class="control-label compact"><span>Master</span><output data-control-readout>${this.escapeHtml(this.mixerState.masterVolume)}</output><input data-module-input="master-volume" type="range" min="0" max="1" step="0.01" value="${this.escapeHtml(this.mixerState.masterVolume)}" aria-label="Master volume"></label><button type="button" data-module-action="unsolo-all">UNSOLO ALL</button><span class="microcopy">${strips.length} channels · mute/solo/pan/level controls</span></div><div class="mixer-desk-grid">${rows}</div>`;
  }

  syncControlReadout(input) {
    const output = input?.closest('label')?.querySelector('[data-control-readout]');
    if (output) output.textContent = input.value;
  }

  applyMixerChannel(moduleId) {
    const module = this.patchBay.modules.get(moduleId);
    const channel = this.mixerState.channels[moduleId];
    if (!module || !channel) return;
    if ('gainValue' in module) module.gainValue = channel.gain;
    if ('panValue' in module) module.panValue = channel.pan;
    if ('muted' in module) module.muted = channel.muted;
    if (module.output?.gain && this.runtime.context)
      module.output.gain.setTargetAtTime(
        channel.muted ? 0 : channel.gain,
        this.runtime.context.currentTime,
        0.01
      );
    if (module.pan?.pan && this.runtime.context)
      module.pan.pan.setTargetAtTime(channel.pan, this.runtime.context.currentTime, 0.01);
    module.apply?.();
  }

  setSynthParam(module, key, rawValue) {
    if (!module || !key) return;
    const value = ['waveform', 'oscillatorType', 'wavetable', 'modulationMode'].includes(key)
      ? rawValue
      : Number(rawValue);
    if (key.startsWith('oscillatorMix.')) {
      const mixKey = key.split('.')[1];
      module.oscillatorMix = { ...(module.oscillatorMix || {}), [mixKey]: Number(rawValue) };
      return;
    }
    if (key === 'waveform') {
      if ('waveform' in module) module.waveform = rawValue;
      if ('oscillatorType' in module) module.oscillatorType = rawValue;
      return;
    }
    module.setParam?.(key, rawValue);
    if (key in module) module[key] = value;
    if (key === 'cutoff' && module.filter && module.ctx)
      module.filter.frequency.setTargetAtTime(module.cutoff, module.ctx.currentTime, 0.02);
    if (key === 'resonance' && module.filter?.Q && module.ctx)
      module.filter.Q.setTargetAtTime(module.resonance, module.ctx.currentTime, 0.02);
    if (
      key === 'driveAmount' &&
      module.drive &&
      'curve' in module.drive &&
      typeof module.setParam === 'function'
    )
      module.setParam('driveAmount', module.driveAmount);
  }

  handleWorkspaceInput(event) {
    const isContinuousControl =
      event.target.type === 'range' || event.target.type === 'number';
    if (event.type === 'change' && isContinuousControl) return;
    const isLiveInput = event.type === 'input' && isContinuousControl;
    if (isContinuousControl) this.syncControlReadout(event.target);
    const arrangementInput = event.target.closest('[data-arrangement-input]');
    if (arrangementInput) {
      const kind = arrangementInput.dataset.arrangementInput;
      if (kind === 'loop-start' || kind === 'loop-end') {
        const root = document.querySelector('#workspaceMainView');
        this.setArrangementLoop(
          root?.querySelector('[data-arrangement-input="loop-start"]')?.value ??
            this.arrangement.loopStartBeat,
          root?.querySelector('[data-arrangement-input="loop-end"]')?.value ??
            this.arrangement.loopEndBeat
        );
      }
      if (kind === 'preview-beat') this.previewArrangementBeat(arrangementInput.value);
      return;
    }
    const input = event.target.closest('[data-module-input]');
    if (!input) return;
    const type = input.dataset.moduleInput;
    const moduleId = input.dataset.moduleId;
    if (type === 'master-volume') {
      this.mixerState.masterVolume = Number(input.value);
      this.runtime.setMasterVolume?.(this.mixerState.masterVolume);
      this.publishProjectChange('mixer-master-volume');
      return;
    }
    if (type === 'mixer-gain' || type === 'mixer-pan') {
      const module = this.patchBay.modules.get(moduleId);
      if (!module) return;
      const channel = this.ensureMixerChannel(module);
      if (type === 'mixer-gain') channel.gain = Number(input.value);
      if (type === 'mixer-pan') channel.pan = Number(input.value);
      this.applyMixerChannel(moduleId);
      this.publishProjectChange(type);
      return;
    }
    if (type === 'note-velocity') {
      const module = this.patchBay.modules.get(moduleId);
      const note = module?.notes?.find((candidate) => candidate.id === input.dataset.noteId);
      if (!note) return;
      note.velocity = Number(input.value);
      if (!isLiveInput) module.render?.();
      this.publishProjectChange('piano-note-velocity');
      return;
    }
    const module = this.patchBay.modules.get(moduleId);
    if (!module) return;
    if (type === 'clock-bpm') {
      module.bpm = Math.max(40, Math.min(260, Number(input.value) || module.bpm || 120));
      if (!isLiveInput) {
        module.render?.();
        this.renderWorkspaceView();
      }
      this.publishProjectChange('clock-bpm');
      return;
    }
    if (type === 'synth-waveform') {
      if ('waveform' in module) module.waveform = input.value;
      if ('oscillatorType' in module) module.oscillatorType = input.value;
      module.render?.();
      this.publishProjectChange('synth-waveform');
      return;
    }
    if (type === 'synth-cutoff') {
      module.cutoff = Number(input.value) || module.cutoff;
      if (module.filter && module.ctx)
        module.filter.frequency.setTargetAtTime(module.cutoff, module.ctx.currentTime, 0.02);
      module.render?.();
      this.publishProjectChange('synth-cutoff');
      return;
    }
    if (type === 'synth-release') {
      module.release = Number(input.value) || module.release;
      module.render?.();
      this.publishProjectChange('synth-release');
      return;
    }
    if (type === 'synth-param') {
      this.setSynthParam(module, input.dataset.paramKey, input.value);
      if (!isLiveInput) this.renderWorkspaceView();
      this.publishProjectChange('synth-param');
      return;
    }
    if (type === 'effect-param') {
      module.setParam?.(input.dataset.paramKey, input.value);
      if (!isLiveInput) this.renderWorkspaceView();
      this.publishProjectChange('effect-param');
      return;
    }
    if (type === 'sampler-param') {
      module.setParam?.(input.dataset.paramKey, input.value);
      if (!isLiveInput) this.renderWorkspaceView();
      this.publishProjectChange('sampler-param');
      return;
    }
    if (type === 'sampler-meta') {
      const key = input.dataset.metaKey;
      const value =
        key === 'tags'
          ? input.value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : input.value;
      module.setSampleMetadata?.({ [key]: value });
      if (!isLiveInput) this.renderWorkspaceView();
      this.publishProjectChange('sampler-meta');
      return;
    }
    if (type === 'drum-swing') {
      module.swing = input.value;
      module.render?.();
      this.publishProjectChange('drum-swing');
      return;
    }
    if (type === 'drum-resolution') {
      module.swingResolution = input.value;
      module.render?.();
      this.publishProjectChange('drum-resolution');
      return;
    }
    if (type === 'drum-pad') {
      const current = module.pads?.get(input.dataset.padId) || {};
      const raw = input.value;
      const value = ['gain', 'pan'].includes(input.dataset.padKey) ? Number(raw) : raw;
      module.assignPad?.(input.dataset.padId, { ...current, [input.dataset.padKey]: value });
      if (!isLiveInput) this.renderWorkspaceView();
      this.publishProjectChange('drum-pad');
      return;
    }
    if (type === 'multisampler-slices') {
      module.sliceCount = Math.max(1, Math.min(64, Number(input.value) || module.sliceCount || 8));
      if (!isLiveInput) module.render?.();
      this.publishProjectChange('multisampler-slices');
      return;
    }
    if (type === 'multisampler-zone') {
      const zone = module.zones?.[Number(input.dataset.zoneIndex)];
      if (!zone) return;
      const key = input.dataset.zoneKey;
      if (key === 'min' || key === 'max') zone[key] = module.midi?.(input.value) ?? zone[key];
      else zone[key] = input.value;
      if (!isLiveInput) module.render?.();
      this.publishProjectChange('multisampler-zone');
      return;
    }
    if (type === 'sequencer-length') {
      module.setLength?.(input.value);
      this.renderWorkspaceView();
      this.publishProjectChange('sequencer-length');
      return;
    }
    if (type === 'sequencer-velocity' || type === 'sequencer-micro') {
      const patch =
        type === 'sequencer-velocity' ? { velocity: input.value } : { microTiming: input.value };
      module.setStep?.(input.dataset.rowId, Number(input.dataset.stepIndex), patch);
      if (!isLiveInput) this.renderWorkspaceView();
      this.publishProjectChange(type);
      return;
    }
    if (type === 'ocra-row') {
      const rowIndex = Number(input.dataset.rowIndex);
      const value = String(input.value || '')
        .padEnd(32, '.')
        .slice(0, 32);
      if (module.grid?.[rowIndex]) module.grid[rowIndex] = value.split('');
      module.renderGrid?.(null);
      this.publishProjectChange('ocra-row');
      return;
    }
    if (type === 'arp-notes') {
      module.notes = input.value
        .split(',')
        .map((note) => note.trim())
        .filter(Boolean);
      module.velocities = new Map(module.notes.map((note) => [note, 0.7]));
      module.render?.();
      this.renderWorkspaceView();
      this.publishProjectChange('arp-notes');
      return;
    }
    if (type === 'arp-param') {
      module.setParam?.(input.dataset.paramKey, input.value);
      this.renderWorkspaceView();
      this.publishProjectChange('arp-param');
      return;
    }
    if (type === 'field-take') {
      module.takes = module.takes || [];
      const take = module.takes[Number(input.dataset.takeIndex)];
      if (!take) return;
      const key = input.dataset.takeKey;
      take[key] = ['startMs', 'endMs'].includes(key) ? Number(input.value) || 0 : input.value;
      this.publishProjectChange('field-take');
      return;
    }
    if (type === 'peer-pilot') {
      module.lastPilot = input.value || 'pilot';
      this.publishProjectChange('peer-pilot');
      return;
    }
    if (type === 'waveform-edit') {
      const edit = this.ensureWaveformEdit(module);
      const key = input.dataset.waveformKey;
      edit[key] = key === 'gain' ? Number(input.value) : Math.max(0, Number(input.value) || 0);
      if (edit.trimEndMs && edit.trimStartMs > edit.trimEndMs) edit.trimStartMs = edit.trimEndMs;
      this.publishProjectChange('waveform-edit');
    }
  }

  handleDrumPadFileInput(event) {
    const input = event.target.closest('.drum-pad-file-input');
    if (!input) return;
    const file = input.files?.[0];
    if (!file) return;
    const moduleId = input.dataset.moduleId;
    const padId = input.dataset.padId;
    const module = this.patchBay.modules.get(moduleId);
    if (!module?.loadPadFile) return;
    module.loadPadFile(padId, file).then(() => {
      this.logText(`drum pad sample loaded: ${padId} = ${file.name}`);
      this.renderWorkspaceView();
      this.publishProjectChange('drum-pad-sample-loaded');
    });
  }

  handleModuleAction(action, target) {
    if (action === 'project-sync-now') {
      this.requestLocalSessionProject({ force: true });
      return;
    }
    if (action === 'peer-reconnect') {
      this.bootstrapDefaultPeernetSession({ force: true }).catch((error) =>
        this.logText(`peer reconnect failed: ${error.message}`)
      );
      return;
    }
    if (action === 'unsolo-all') {
      for (const channel of Object.values(this.mixerState.channels)) {
        channel.solo = false;
      }
      for (const id of Object.keys(this.mixerState.channels)) this.applyMixerChannel(id);
      this.renderWorkspaceView();
      this.publishProjectChange('unsolo-all');
      return;
    }
    const moduleId = target.dataset.moduleId;
    const module = this.patchBay.modules.get(moduleId);
    if (!module) return;
    if (action === 'focus-module') {
      this.focusedModuleId = moduleId;
      this.refreshFocusedModuleCard();
      this.setWorkspaceView('module');
      return;
    }
    if (action === 'toggle-mute' || action === 'toggle-solo') {
      const channel = this.ensureMixerChannel(module);
      if (action === 'toggle-mute') channel.muted = !channel.muted;
      if (action === 'toggle-solo') channel.solo = !channel.solo;
      this.applyMixerChannel(moduleId);
      this.renderWorkspaceView();
      this.publishProjectChange(action);
      return;
    }
    if (action === 'toggle-note') {
      const stepResolution = module.stepResolutionBeats || 0.25;
      const beat = Number(target.dataset.step) * stepResolution;
      const noteName = target.dataset.note;
      const index = module.notes?.findIndex(
        (note) =>
          note.note === noteName &&
          Math.round(note.beat / stepResolution) === Number(target.dataset.step)
      );
      if (index >= 0) module.notes.splice(index, 1);
      else
        module.notes.push({
          id: `note-${Date.now()}-${module.notes.length}`,
          kind: PortType.MIDI,
          type: 'note-on',
          beat,
          note: noteName,
          velocity: 0.8,
          duration: stepResolution * 2,
        });
      module.notes.sort((a, b) => a.beat - b.beat || a.note.localeCompare(b.note));
      module.render?.();
      this.renderWorkspaceView();
      this.publishProjectChange('piano-note-toggle');
      return;
    }
    if (action === 'add-note') {
      module.notes = module.notes || [];
      module.notes.push({
        id: `note-${Date.now()}`,
        kind: PortType.MIDI,
        type: 'note-on',
        beat: 0,
        note: 'C4',
        velocity: 0.8,
        duration: module.stepResolutionBeats || 0.25,
      });
      module.render?.();
      this.renderWorkspaceView();
      this.publishProjectChange('piano-note-added');
      return;
    }
    if (action === 'clear-notes') {
      module.notes = [];
      module.render?.();
      this.renderWorkspaceView();
      this.publishProjectChange('piano-notes-cleared');
      return;
    }
    if (action === 'apply-swing') {
      module.applySwingToClip?.({ amount: 'swing60', resolution: '1/8' });
      this.renderWorkspaceView();
      this.publishProjectChange('piano-swing-applied');
      return;
    }
    if (action === 'audition-note') {
      module.noteOn?.('C4', 0.7);
      setTimeout(() => module.noteOff?.('C4'), 250);
      this.logText(`audition: ${module.title}`);
      return;
    }
    if (action === 'audition-chord') {
      ['C4', 'E4', 'G4'].forEach((note) => module.noteOn?.(note, 0.55));
      setTimeout(() => ['C4', 'E4', 'G4'].forEach((note) => module.noteOff?.(note)), 350);
      this.logText(`audition chord: ${module.title}`);
      return;
    }
    if (action === 'sampler-play') {
      module.play?.(module.rootNote || 'C4', 0.9);
      this.logText(`sampler play: ${module.title}`);
      return;
    }
    if (action === 'sampler-sync-library') {
      const detail = module.syncMetadataToLibrary?.();
      if (detail) this.syncModuleMetadataToSampleLibrary(detail);
      this.publishProjectChange('sampler-sync-library');
      return;
    }
    if (action === 'sampler-add-cue') {
      module.addCue?.({
        startMs: 0,
        bpm: module.sampleMetadata?.bpm || 120,
        name: `cue ${(module.sampleMetadata?.cues?.length || 0) + 1}`,
      });
      this.renderWorkspaceView();
      this.publishProjectChange('sampler-add-cue');
      return;
    }
    if (action === 'sampler-gen-cues') {
      module.generateInBeatCues?.({ startMs: 0, bpm: module.sampleMetadata?.bpm || 120, beats: 4 });
      this.renderWorkspaceView();
      this.publishProjectChange('sampler-gen-cues');
      return;
    }
    if (action === 'drum-trigger-pad') {
      const note = target.dataset.padNote || 'C4';
      if (typeof module.trigger === 'function') module.trigger(note, 0.85);
      else if (typeof module.play === 'function') module.play(note, 0.85);
      else if (typeof module.noteOn === 'function') {
        module.noteOn(note, 0.7);
        setTimeout(() => module.noteOff?.(note), 250);
      }
      this.logText(`drum pad trigger: ${module.title} ${note}`);
      return;
    }
    if (action === 'drum-load-pad-file') {
      const file = target.files?.[0];
      if (file) {
        module.loadPadFile?.(target.dataset.padId, file).then(() => {
          this.logText(`drum pad sample loaded: ${target.dataset.padId} = ${file.name}`);
          this.renderWorkspaceView();
          this.publishProjectChange('drum-pad-sample-loaded');
        });
      }
      return;
    }
    if (action === 'multisampler-add-zone') {
      module.zones = module.zones || [];
      module.zones.push({
        name: `zone ${module.zones.length + 1}`,
        rootNote: 'C4',
        min: module.midi?.('C1') ?? 24,
        max: module.midi?.('C7') ?? 96,
        buffer: null,
      });
      module.render?.();
      this.renderWorkspaceView();
      this.publishProjectChange('multisampler-add-zone');
      return;
    }
    if (action === 'multisampler-preview-slice') {
      module.play?.('C4', 0.8, undefined, 0);
      this.logText(`multisampler preview slice: ${module.title}`);
      return;
    }
    if (action === 'sequencer-toggle-step') {
      const data = this.cellDataFromElement(target);
      this.selectGridCell(data, { append: target.shiftKey, selected: true });
      this.writeGridCell(data, !this.readGridCellState(data));
      this.renderWorkspaceView();
      this.publishProjectChange('sequencer-toggle-step');
      return;
    }
    if (action === 'sequencer-convert') {
      module.emitConversion?.();
      this.convertModuleToPianoRoll?.(module.id);
      this.logText(`sequencer converted: ${module.title}`);
      this.renderWorkspaceView();
      this.publishProjectChange('sequencer-convert');
      return;
    }
    if (action === 'ocra-clear') {
      module.grid = Array.from({ length: module.grid?.length || 14 }, () =>
        new Array(32).fill('.')
      );
      module.renderGrid?.(null);
      this.renderWorkspaceView();
      this.publishProjectChange('ocra-clear');
      return;
    }
    if (action === 'ocra-basic-pulse') {
      module.initGrid?.();
      module.renderGrid?.(null);
      this.renderWorkspaceView();
      this.publishProjectChange('ocra-basic-pulse');
      return;
    }
    if (action === 'ocra-step') {
      const result = module.runOrca?.();
      module.renderGrid?.(result?.act || null);
      this.logText(`ocra frame: ${module.title}`);
      this.publishProjectChange('ocra-step');
      return;
    }
    if (action === 'ocra-toggle-cell') {
      const data = this.cellDataFromElement(target);
      this.selectGridCell(data, { append: target.shiftKey, selected: true });
      this.writeGridCell(data, !this.readGridCellState(data));
      this.renderWorkspaceView();
      this.publishProjectChange('ocra-toggle-cell');
      return;
    }
    if (action === 'arp-preview') {
      this.logText(`arp pattern: ${(module.arpPattern?.() || []).join(' ') || 'empty'}`);
      return;
    }
    if (action === 'field-add-take') {
      module.takes = module.takes || [];
      module.takes.push({
        name: `take ${module.takes.length + 1}`,
        startMs: 0,
        endMs: module.buffer ? Math.round(module.buffer.duration * 1000) : 0,
        fileName: module.fileName || 'no sample loaded',
      });
      this.renderWorkspaceView();
      this.publishProjectChange('field-add-take');
      return;
    }
    if (action === 'field-delete-take') {
      module.takes?.splice(Number(target.dataset.takeIndex), 1);
      this.renderWorkspaceView();
      this.publishProjectChange('field-delete-take');
      return;
    }
    if (action === 'field-play') {
      module.play?.();
      this.logText(`field play: ${module.title}`);
      return;
    }
    if (action === 'field-promote-sample') {
      this.sampleLibrary.addSample('/field-recorder', {
        filename: module.fileName || 'field take',
        sampleRef: `${module.id}/take`,
        tags: ['field-recorder'],
      });
      this.sampleLibrary.save();
      this.renderSamplePanels();
      this.logText(`field sample promoted: ${module.fileName || module.title}`);
      this.publishProjectChange('field-promote-sample');
      return;
    }
    if (action === 'peer-connect') {
      module.lastPilot =
        document.querySelector(
          `[data-module-input="peer-pilot"][data-module-id="${CSS.escape(module.id)}"]`
        )?.value ||
        module.lastPilot ||
        'pilot';
      module
        .connect?.(module.lastPilot)
        .catch?.((error) => this.logText(`peer connect failed: ${error.message}`));
      this.logText(`peer connect requested: ${module.lastPilot}`);
      return;
    }
    if (action === 'peer-test-packet') {
      module.packetLog = module.packetLog || [];
      const packet = { kind: PortType.CONTROL, type: 'test', value: 'ping' };
      module.packetLog.push(packet);
      module.emitPacket?.(packet, 'control');
      this.logText(`peer test packet: ${module.title}`);
      this.renderWorkspaceView();
      return;
    }
    if (action === 'peer-clear-log') {
      module.packetLog = [];
      this.renderWorkspaceView();
      return;
    }
    if (action === 'waveform-normalize') {
      const edit = this.ensureWaveformEdit(module);
      edit.normalized = true;
      edit.gain = Math.max(edit.gain || 1, 1);
      this.logText(`waveform normalized: ${module.title}`);
      this.renderWorkspaceView();
      this.publishProjectChange('waveform-normalize');
      return;
    }
    if (action === 'waveform-reverse') {
      const edit = this.ensureWaveformEdit(module);
      edit.reverse = !edit.reverse;
      this.logText(`waveform ${edit.reverse ? 'reversed' : 'forward'}: ${module.title}`);
      this.renderWorkspaceView();
      this.publishProjectChange('waveform-reverse');
      return;
    }
    if (action === 'waveform-apply-take') {
      const edit = this.ensureWaveformEdit(module);
      module.takes = module.takes || [];
      module.takes.push({
        name: `edit ${module.takes.length + 1}`,
        startMs: edit.trimStartMs,
        endMs: edit.trimEndMs,
        gain: edit.gain,
        reverse: edit.reverse,
        normalized: edit.normalized,
        fileName: module.fileName || 'sample',
      });
      this.logText(`waveform edit applied as take: ${module.title}`);
      this.renderWorkspaceView();
      this.publishProjectChange('waveform-apply-take');
    }
  }

  moduleClipSummary(module) {
    const serialized = module.serialize?.() || {};
    const patterns =
      serialized.patterns || serialized.sequence || serialized.notes || serialized.steps || [];
    const count = Array.isArray(patterns) ? patterns.length : Object.keys(patterns || {}).length;
    return {
      id: module.id,
      title: module.title,
      kind: module.kind,
      count,
      hasTransport:
        module.inputs?.some((p) => p.type === PortType.CLOCK) ||
        module.outputs?.some((p) => p.type === PortType.CLOCK),
    };
  }

  detectSignalChains() {
    const modules = this.workspaceModules();
    const adj = new Map();
    const inbound = new Map();
    for (const m of modules) {
      adj.set(m.id, new Set());
      inbound.set(m.id, new Set());
    }
    for (const route of this.patchBay.routes) {
      adj.get(route.from.moduleId)?.add(route.to.moduleId);
      inbound.get(route.to.moduleId)?.add(route.from.moduleId);
    }
    for (const edge of this.routingGraph.edges) {
      if (edge.to === 'destination') continue;
      adj.get(edge.from)?.add(edge.to);
      inbound.get(edge.to)?.add(edge.from);
    }
    const visited = new Set();
    const chains = [];
    const sources = modules.filter((m) => (inbound.get(m.id)?.size || 0) === 0);
    const walk = (id, chain) => {
      if (visited.has(id)) return;
      visited.add(id);
      chain.push(id);
      for (const next of adj.get(id) || []) walk(next, chain);
    };
    for (const source of sources) {
      if (visited.has(source.id)) continue;
      const chain = [];
      walk(source.id, chain);
      if (chain.length > 0) chains.push(chain);
    }
    for (const m of modules) {
      if (!visited.has(m.id)) {
        const chain = [];
        walk(m.id, chain);
        if (chain.length > 0) chains.push(chain);
      }
    }
    return chains;
  }

  chainModuleKindLabel(module) {
    if (module.kind === 'clock') return 'clock';
    if (
      module.kind === 'midi-generator' ||
      module.kind === 'sequencer' ||
      Array.isArray(module.rows) ||
      Array.isArray(module.grid)
    )
      return 'seq';
    if (this.isSamplerModule(module)) return 'sampler';
    if (module.kind === 'audio-source' || typeof module.noteOn === 'function') return 'synth';
    if (module.kind?.includes('effect') || Array.isArray(module.params)) return 'fx';
    if (module.kind === 'network') return 'net';
    return 'util';
  }

  chainKindBorderClass(kind) {
    const map = {
      clock: 'kind-clock',
      seq: 'kind-midi-generator',
      synth: 'kind-instrument',
      sampler: 'kind-instrument',
      fx: 'kind-effect',
      net: 'kind-network',
      util: 'kind-utility',
    };
    return map[kind] || '';
  }

  renderChainNodeControls(module) {
    const kind = this.chainModuleKindLabel(module);
    const parts = [];
    if (kind === 'clock') {
      parts.push(
        `<label>BPM <input data-module-input="clock-bpm" data-module-id="${this.escapeHtml(module.id)}" type="number" min="40" max="260" step="1" value="${this.escapeHtml(module.bpm || 120)}"></label>`
      );
    }
    if (kind === 'synth') {
      const waveforms = ['sine', 'triangle', 'sawtooth', 'square'];
      const wf = module.waveform || module.oscillatorType || 'triangle';
      if ('waveform' in module || 'oscillatorType' in module)
        parts.push(
          `<label>Wave <select data-module-input="synth-param" data-param-key="waveform" data-module-id="${this.escapeHtml(module.id)}">${waveforms.map((w) => `<option value="${w}" ${w === wf ? 'selected' : ''}>${w}</option>`).join('')}</select></label>`
        );
      if ('cutoff' in module)
        parts.push(
          `<label>Cutoff <input data-module-input="synth-param" data-param-key="cutoff" data-module-id="${this.escapeHtml(module.id)}" type="range" min="80" max="12000" step="1" value="${this.escapeHtml(module.cutoff || 2000)}"></label>`
        );
      if ('attack' in module)
        parts.push(
          `<label>Atk <input data-module-input="synth-param" data-param-key="attack" data-module-id="${this.escapeHtml(module.id)}" type="range" min="0.001" max="2" step="0.001" value="${this.escapeHtml(module.attack ?? 0.01)}"></label>`
        );
      if ('release' in module)
        parts.push(
          `<label>Rel <input data-module-input="synth-param" data-param-key="release" data-module-id="${this.escapeHtml(module.id)}" type="range" min="0.001" max="4" step="0.001" value="${this.escapeHtml(module.release ?? 0.1)}"></label>`
        );
    }
    if (kind === 'sampler' && module.pads instanceof Map) {
      const pads = [...module.pads.values()];
      const loaded = pads.filter((p) => p.buffer).length;
      parts.push(`<span class="microcopy">${loaded}/${pads.length} pads loaded</span>`);
    }
    if (kind === 'sampler' && !(module.pads instanceof Map)) {
      parts.push(
        `<span class="microcopy">${this.escapeHtml(module.fileName || 'no sample')}</span>`
      );
      if ('rootNote' in module)
        parts.push(
          `<label>Root <input data-module-input="sampler-param" data-param-key="rootNote" data-module-id="${this.escapeHtml(module.id)}" type="text" value="${this.escapeHtml(module.rootNote || 'C4')}"></label>`
        );
    }
    if (kind === 'fx') {
      const fxParams = Array.isArray(module.params) ? module.params.slice(0, 3) : [];
      for (const param of fxParams) {
        parts.push(
          `<label>${this.escapeHtml(param.label || param.key)} <input data-module-input="effect-param" data-module-id="${this.escapeHtml(module.id)}" data-param-key="${this.escapeHtml(param.key)}" type="range" min="${this.escapeHtml(param.min)}" max="${this.escapeHtml(param.max)}" step="${this.escapeHtml(param.step || 0.01)}" value="${this.escapeHtml(module[param.key])}"></label>`
        );
      }
    }
    if (kind === 'seq') {
      const noteCount = Array.isArray(module.notes)
        ? module.notes.length
        : Array.isArray(module.rows)
          ? module.rows.reduce((sum, r) => sum + r.steps.filter((s) => s.enabled).length, 0)
          : 0;
      parts.push(`<span class="microcopy">${noteCount} active steps</span>`);
    }
    const channel = this.mixerState.channels[module.id];
    if (channel || module.outputs?.some((p) => p.type === PortType.AUDIO)) {
      const ch = channel || this.ensureMixerChannel(module);
      parts.push(
        `<label>Level <input data-module-input="mixer-gain" data-module-id="${this.escapeHtml(module.id)}" type="range" min="0" max="1.5" step="0.01" value="${this.escapeHtml(ch.gain)}"></label>`
      );
    }
    return parts.join('');
  }

  chainConnectionType(fromId, toId) {
    const hasAudio = this.routingGraph.edges.some(
      (e) => e.from === fromId && e.to === toId && e.type === 'audio'
    );
    if (hasAudio) return 'audio';
    const route = this.patchBay.routes.find(
      (r) => r.from.moduleId === fromId && r.to.moduleId === toId
    );
    if (!route) return 'control';
    const fromModule = this.patchBay.modules.get(fromId);
    const outPort = fromModule?.outputs?.find((p) => p.id === route.from.outputId);
    if (outPort?.type === PortType.MIDI) return 'midi';
    if (outPort?.type === PortType.CLOCK) return 'control';
    return 'control';
  }

  renderChainView() {
    const chains = this.detectSignalChains();
    const assigned = new Set(chains.flat());
    const orphans = this.workspaceModules().filter((m) => !assigned.has(m.id));

    const chainCards = chains
      .map((chain, _chainIndex) => {
        const modules = chain.map((id) => this.patchBay.modules.get(id)).filter(Boolean);
        if (!modules.length) return '';
        const label =
          modules.length === 1
            ? modules[0].title
            : `${modules[0].title} → ${modules[modules.length - 1].title}`;
        const nodeHtmls = modules.map((module) => {
          const kind = this.chainModuleKindLabel(module);
          return `<div class="chain-node ${this.chainKindBorderClass(kind)}"><div class="chain-node-head"><strong>${this.escapeHtml(module.title)}</strong><span class="chain-node-kind">${kind}</span></div><div class="chain-node-controls">${this.renderChainNodeControls(module)}</div><div class="chain-node-actions"><button type="button" data-module-action="focus-module" data-module-id="${this.escapeHtml(module.id)}">OPEN</button><button type="button" data-module-action="drum-trigger-pad" data-module-id="${this.escapeHtml(module.id)}" data-pad-note="C4" style="${typeof module.trigger === 'function' || typeof module.play === 'function' || typeof module.noteOn === 'function' ? '' : 'display:none'}">PLAY</button></div></div>`;
        });
        const nodes = nodeHtmls.reduce((acc, html, i) => {
          if (i === 0) return html;
          const connType = this.chainConnectionType(modules[i - 1].id, modules[i].id);
          return `${acc}<div class="chain-arrow conn-${connType}"></div>${html}`;
        }, '');
        const source = modules[0];
        const output = modules[modules.length - 1];
        const processors = modules.slice(1, -1);
        const editable =
          modules.find((module) => this.moduleEditActionLabel(module) !== 'OPEN MODULE') || source;
        const chainId = chain.join('>');
        const selected = chainId === this.selectedChainId;
        return `<article class="signal-chain ${selected ? 'selected-chain' : ''}" data-chain-card="${this.escapeHtml(chainId)}" data-selected-chain="${selected ? 'true' : 'false'}"><div class="chain-header"><strong>${this.escapeHtml(label)}</strong><span class="chain-badge">${modules.length} modules</span></div><div class="chain-role-strip"><span>Source: ${this.escapeHtml(source?.title || 'unknown')}</span><span>Processor/Mixer: ${this.escapeHtml(processors.map((module) => module.title).join(' → ') || 'direct')}</span><span>Output: ${this.escapeHtml(output?.title || 'destination')}</span></div><p class="microcopy chain-edit-hint">${this.escapeHtml(this.moduleOperationalHint(editable))}</p><div class="chain-flow">${nodes}</div></article>`;
      })
      .join('');

    const orphanChips = orphans.length
      ? `<div class="chain-orphans"><span class="microcopy">${orphans.length} unpatched</span><div class="chain-orphan-grid">${orphans.map((m) => `<button class="chain-orphan-chip" type="button" data-module-action="focus-module" data-module-id="${this.escapeHtml(m.id)}">${this.escapeHtml(m.title)}</button>`).join('')}</div></div>`
      : '';

    return `<div class="chain-list">${chainCards || '<p class="microcopy">No modules yet. Add modules and patch them to see signal chains.</p>'}${orphanChips}</div>`;
  }

  renderSampleLibraryView() {
    const project = this.serializeRig();
    const samples = this.sampleLibrary.listSamples();
    const slots = detectProjectSampleSlots(project, this.sampleLibrary).map((slot) => {
      const progress = this.sampleSyncProgress.get(slot.id)?.progress;
      return progress !== undefined
        ? { ...slot, availability: progress >= 1 ? 'available' : 'syncing', progress }
        : slot;
    });
    return `<div class="sample-library-workspace"><div class="workspace-toolbar"><strong>Sample Library</strong><span class="microcopy">${samples.length} files · ${slots.length} project slots · select a file, then assign it to any open or loaded slot.</span><button type="button" data-sample-action="pick-upload">UPLOAD FILES</button></div>${renderSampleLibraryMatrixHtml({ samples, slots, selectedSampleId: this.selectedSampleId })}</div>`;
  }

  renderWorkspaceView() {
    const root = document.querySelector('#workspaceMainView');
    if (!root) return;
    const modules = this.workspaceModules();
    const activeSession = this.peernet.sessions?.getActiveSession?.();
    const code = activeSession?.code || this.sessionCode || this.defaultSessionCode;
    const routeCount = this.patchBay.routes.length;
    const audioRoutes = this.routingGraph.edges.filter((edge) => edge.type === 'audio').length;
    const view = this.workspaceView || 'session';
    if (view === 'chains') {
      root.innerHTML = this.renderChainView();
      root
        .querySelector(`[data-chain-card="${CSS.escape(this.selectedChainId || '')}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (view === 'session') {
      const participantCount =
        (activeSession?.participants?.length || 1) +
        this.localSessionPeers.size +
        this.peerList.length;
      const chains = this.detectSignalChains();
      const assigned = new Set(chains.flat());
      const unpatched = modules.filter((module) => !assigned.has(module.id)).length;
      const health = this.peernetHealth || this.peernet.health();
      const syncDiagnostics = this.projectSync.diagnostics();
      const peernetSync = syncDiagnostics.transports.peernet || {};
      const localSync = syncDiagnostics.transports.local || {};
      const syncLastAt = Math.max(
        peernetSync.sentAt || 0,
        peernetSync.receivedAt || 0,
        localSync.sentAt || 0,
        localSync.receivedAt || 0
      );
      const syncLastText = syncLastAt
        ? new Date(syncLastAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : 'no traffic yet';
      root.innerHTML = `<div class="workspace-grid"><article class="workspace-card"><strong>Shared session</strong><span class="big-number">${this.escapeHtml(code)}</span><p class="microcopy">Default mode auto-connects every visitor to this open Peernet/PeerJS-backed studio session.</p></article><article class="workspace-card signal-flow-overview-card"><strong>Signal Flow</strong><span class="big-number">${chains.length}</span><p class="microcopy">${chains.length} module chains · ${unpatched} unpatched modules. Inspect how clips, instruments, effects, and mixer outputs make sound.</p><button type="button" data-workspace-view="chains">Inspect Signal Flow</button></article><article class="workspace-card"><strong>Participants</strong><span class="big-number">${participantCount}</span><p class="microcopy">Local pilot plus connected Peernet or same-session fallback peers.</p></article><article class="workspace-card"><strong>Network health</strong><span class="big-number">${this.escapeHtml(health.state || 'idle')}</span><p class="microcopy">role ${this.escapeHtml(health.role || 'offline')} · ${this.escapeHtml(health.peerCount || 0)} direct peers · ${health.lastError ? `last error ${this.escapeHtml(health.lastError)}` : 'transport healthy'}</p><button type="button" data-module-action="peer-reconnect">Reconnect</button></article><article class="workspace-card"><strong>Project sync</strong><span class="big-number">v${this.localProjectVersion}</span><p class="microcopy">${this.escapeHtml(this.localSyncStatus)} · last traffic ${this.escapeHtml(syncLastText)} · Peernet ${this.escapeHtml(peernetSync.peerCount || 0)} links · local ${this.escapeHtml(localSync.peerCount || 0)} peers${syncDiagnostics.lastAckClientId ? ` · ack ${this.escapeHtml(syncDiagnostics.lastAckClientId)}` : ''}</p><button type="button" data-module-action="project-sync-now">Sync now</button></article><article class="workspace-card"><strong>Rig state</strong><span class="big-number">${modules.length}</span><p class="microcopy">${routeCount} packet routes · ${audioRoutes} audio routes · ${this.peernet.started ? 'peernet active' : 'local-first fallback'} · local bus ${this.localSessionBus ? 'ready' : 'off'}</p></article></div>`;
      return;
    }
    if (view === 'samples') {
      root.innerHTML = this.renderSampleLibraryView();
      return;
    }
    if (view === 'clips') {
      this.ensureDefaultClipSlots();
      const rows = this.clipSlots
        .map((slot) => {
          const active = Boolean(slot.activeClipAt(this.currentBeat));
          const module = this.patchBay.modules.get(slot.moduleId);
          const chainSummary = this.chainSummaryForModule(slot.moduleId);
          const editLabel = this.moduleEditActionLabel(module);
          const hint = this.moduleOperationalHint(module);
          return `<div class="clip-slot-row ${active ? 'active' : ''}" data-clip-slot-row="${this.escapeHtml(slot.id)}" data-module-id="${this.escapeHtml(slot.moduleId || '')}" data-chain-module-id="${this.escapeHtml(slot.moduleId || '')}"><div><strong>${this.escapeHtml(slot.name || slot.clip?.name || slot.id)}</strong><span class="microcopy">Module: ${this.escapeHtml(module?.title || slot.moduleId)} · Chain: ${this.escapeHtml(chainSummary)} · ${this.escapeHtml(slot.clip?.midi?.length || 0)} notes · q${this.escapeHtml(slot.quantizationBeats)}</span><p class="microcopy clip-edit-hint">${this.escapeHtml(hint)}</p></div><span class="pill">${active ? 'playing' : slot.launchBeat == null ? 'empty' : 'queued'}</span><div class="button-row"><button type="button" data-clip-action="launch" data-slot-id="${this.escapeHtml(slot.id)}">LAUNCH</button><button type="button" data-clip-action="stop" data-slot-id="${this.escapeHtml(slot.id)}">STOP</button><button type="button" data-module-action="focus-module" data-workspace-view-target="module" data-module-id="${this.escapeHtml(slot.moduleId || '')}">OPEN</button><button type="button" data-module-action="focus-module" data-workspace-view-target="module" data-module-id="${this.escapeHtml(slot.moduleId || '')}">${this.escapeHtml(editLabel)}</button><button type="button" data-chain-action="view-chain" data-module-id="${this.escapeHtml(slot.moduleId || '')}">View Chain</button><button type="button" data-clip-action="place" data-slot-id="${this.escapeHtml(slot.id)}">PLACE</button><button type="button" data-clip-action="delete" data-slot-id="${this.escapeHtml(slot.id)}">DEL</button></div></div>`;
        })
        .join('');
      root.innerHTML = `<div class="workspace-toolbar"><button type="button" data-clip-action="create">CREATE CLIP</button><button type="button" data-clip-action="place-all">PLACE ALL</button><button type="button" data-clip-action="clear-arrangement">CLEAR ARRANGEMENT</button><span class="microcopy">beat ${this.escapeHtml(this.currentBeat)} · ${this.clipSlots.length} slots · backed by ClipSlot/Clip core</span></div><div class="workspace-list">${rows || '<p class="microcopy">No clip slots yet. Add a piano roll, OCRA grid, or sequencer, then create a clip.</p>'}</div>`;
      return;
    }
    if (view === 'arrangement') {
      root.innerHTML = this.renderArrangementEditor();
      return;
    }
    if (view === 'mixer') {
      root.innerHTML = this.renderMixerEditor();
      return;
    }
    const focused =
      modules.find((module) => module.id === this.focusedModuleId) ||
      modules.find(
        (module) => module.id === document.querySelector('.module-card:hover')?.dataset.moduleId
      ) ||
      modules.find((module) => Array.isArray(module.notes)) ||
      modules.find((module) => module.kind === 'midi-generator') ||
      modules[0];
    if (!focused) {
      root.innerHTML = '<p class="microcopy">No module selected.</p>';
      return;
    }
    const detail = this.isPatternModule(focused)
      ? this.renderPatternEditor(focused)
      : focused.kind === 'midi-generator' && Array.isArray(focused.notes)
        ? this.renderPianoRollEditor(focused)
        : this.isSamplerModule(focused)
          ? this.renderSamplerEditor(focused)
          : focused.id?.includes('field') ||
              focused.title?.toLowerCase?.().includes('field recorder')
            ? this.renderFieldRecorderEditor(focused)
            : focused.kind === 'network' ||
                focused.id?.includes('peer') ||
                focused.id?.includes('wiring')
              ? this.renderPeerMonitorEditor(focused)
              : this.renderGenericModuleEditor(focused);
    root.innerHTML = detail;
  }

  updateSessionUI() {
    const codeEl = document.querySelector('#sessionCode');
    const listEl = document.querySelector('#peerList');
    const activeSession = this.peernet.sessions?.getActiveSession?.();
    const code = activeSession?.code || this.sessionCode || this.defaultSessionCode;
    this.sessionCode = code;

    if (codeEl) codeEl.textContent = code;
    const codeInput = document.querySelector('#sessionCodeInput');
    if (codeInput && document.activeElement !== codeInput) codeInput.value = code;

    const participants = activeSession?.participants || [];
    const remotePeers = this.peerList.map((p) => ({
      id: p.id || p.peerId || p.name || 'peer',
      username: p.name || p.username || 'peer',
      role: 'peer',
    }));
    const localBusPeers = [...this.localSessionPeers.values()].map((p) => ({
      id: p.id,
      username: p.name || 'peer',
      role: 'local-session',
    }));
    const rows = [...participants, ...remotePeers, ...localBusPeers];
    if (listEl) {
      listEl.innerHTML = rows.length
        ? rows
            .map(
              (p) =>
                `<div class="peer-item"><span class="peer-dot"></span>${this.escapeHtml(p.username || p.name || p.id || 'pilot')} <small>${this.escapeHtml(p.role || 'participant')}</small></div>`
            )
            .join('')
        : '<div class="peer-item dim">local pilot waiting for peers</div>';
    }
    this.renderPeerCounts();
    if (this.workspaceView === 'session') this.renderWorkspaceView();
  }

  renderPeerCounts() {
    const direct = this.peerList.length;
    const hub = Number(this.subLobby.snapshot()?.peers?.size || 0);
    const local = this.localSessionPeers.size;
    const total = direct + hub + local;
    const values = {
      directPeerCount: direct,
      hubPeerCount: hub,
      localPeerCount: local,
    };
    for (const [id, value] of Object.entries(values)) {
      const node = document.querySelector(`#${id}`);
      if (node) node.textContent = String(value);
    }
    const totalNode = document.querySelector('#peerCount');
    if (totalNode) totalNode.textContent = `${total} peer${total === 1 ? '' : 's'}`;
  }

  async bootstrapDefaultPeernetSession({ force = false } = {}) {
    if (this.peernet.started && !force) return this.peernet.sessions?.getActiveSession?.() || null;
    const username =
      this.urlParams.get('username') || document.querySelector('#pilotName')?.value || 'pilot';
    const pilotEl = document.querySelector('#pilotName');
    if (pilotEl) pilotEl.value = username;
    this.subLobby.setUsername(username);
    const profile = {
      username,
      targetPeerId: this.targetPeerId,
      spectate: this.spectateMode,
      sessionCode: this.defaultSessionCode,
    };
    if (force && this.peernet.started) this.peernet.reconnect(profile);
    else this.peernet.start(profile);
    const session = this.peernet.ensureSharedSession({
      id: `v11-peer-daw:session:${this.defaultSessionCode}`,
      code: this.defaultSessionCode,
      title: 'V11 Open Studio Session',
    });
    this.sessionCode = session?.code || this.defaultSessionCode;
    this.updateSessionUI();
    this.logText(`default shared session ready: ${this.sessionCode}`);
    return session;
  }

  async ensureSubLobbyConnected() {
    if (this.subLobby.state.appHubConnected) return;
    const username = document.querySelector('#pilotName')?.value || 'pilot';
    this.subLobby.setUsername(username);
    await this.subLobby.connect();
  }

  updateSubLobbyUI(state = this.subLobby.snapshot()) {
    const statusEl = document.querySelector('#subLobbyStatus');
    const listEl = document.querySelector('#subLobbyPeerList');
    if (statusEl) {
      const room = state.subLobbyId
        ? state.subLobbyId.replace('v11-peer-daw-sublobby-', '')
        : 'none';
      statusEl.textContent = `sub-lobby: ${state.role} · ${room} · ${state.joinBlocked ? 'blocked' : 'open'}`;
    }
    if (listEl) {
      const peers = [...(state.subLobbyPeers || new Map()).entries()];
      listEl.innerHTML = peers.length
        ? peers
            .map(
              ([id, peer]) =>
                `<div class="peer-item"><span class="peer-dot"></span>${this.escapeHtml(peer.username || id)}</div>`
            )
            .join('')
        : '<div class="peer-item dim">no sub-lobby peers yet</div>';
    }
    this.renderPeerCounts();
  }

  bindSampleLibrary() {
    this.sampleSync.on('progress', (event) => {
      this.sampleSyncProgress.set(event.slotId, event);
      if (event.progress >= 1) this.sampleLibrary.save();
      this.renderProjectSampleUsage();
      this.renderSampleLibraryTree();
    });
    document.querySelector('#missingSampleSlots')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sample-action]');
      if (button) this.handleSampleAction(button);
    });
  }

  handleSampleAction(button) {
    const slot = button.closest('[data-sample-slot]');
    const slotId = button.dataset.sampleSlot || slot?.dataset.sampleSlot || '';
    const sampleRef = slot?.dataset.sampleRef || slotId;
    const filename = slot?.dataset.filename || '';
    if (button.dataset.sampleAction === 'select-library-sample') {
      this.selectedSampleId = button.dataset.sampleId || null;
      this.renderWorkspaceView();
      this.logText(`selected sample: ${this.selectedSampleId || 'none'}`);
      return;
    }
    if (button.dataset.sampleAction === 'assign-selected') {
      this.assignSelectedSampleToSlot(slotId);
      return;
    }
    if (button.dataset.sampleAction === 'preview-sample') {
      this.previewLibrarySample(button.dataset.sampleId || this.selectedSampleId);
      return;
    }
    if (button.dataset.sampleAction === 'query-peer') {
      this.sampleSync.requestSample({ slotId, sampleRef, filename, peerId: '' });
      this.sampleSyncProgress.set(slotId, { slotId, sampleRef, filename, progress: 0.05 });
      this.renderSamplePanels();
      this.renderWorkspaceView();
      this.logText(`sample query requested: ${filename || sampleRef}`);
      return;
    }
    if (button.dataset.sampleAction === 'pick-upload') {
      this.pendingSampleUploadSlotId = slotId || null;
      document.querySelector('#sampleLibraryUploadFile')?.click();
      return;
    }
    if (button.dataset.sampleAction === 'open-editor') {
      const moduleId = button.dataset.moduleId || slot?.dataset.moduleId || '';
      if (moduleId && this.patchBay.modules.has(moduleId)) {
        this.focusedModuleId = moduleId;
        this.setWorkspaceView('module');
      }
    }
  }

  previewLibrarySample(sampleId = '') {
    const sample = this.sampleLibrary.findSample(sampleId);
    if (!sample) {
      this.logText('sample preview skipped: no library file selected');
      return false;
    }
    const bytes =
      sample.bytes instanceof Uint8Array ? sample.bytes : Uint8Array.from(sample.bytes || []);
    if (!bytes.length) {
      this.logText(`sample preview metadata: ${sample.filename}`);
      return false;
    }
    const blob = new Blob([bytes], { type: sample.type || sample.mime || 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
    audio.play?.().catch((error) => this.logText(`sample preview failed: ${error.message}`));
    this.logText(`preview sample: ${sample.filename}`);
    return true;
  }

  assignSelectedSampleToSlot(slotId = '') {
    const sample = this.sampleLibrary.findSample(this.selectedSampleId);
    const project = this.serializeRig();
    const slot = detectProjectSampleSlots(project, this.sampleLibrary).find(
      (entry) => entry.id === slotId
    );
    if (!sample || !slot) {
      this.logText('sample assignment skipped: select a sample and slot first');
      return false;
    }
    const module = this.patchBay.modules.get(slot.moduleId);
    if (!module) return false;
    const metadata = normalizeSampleMetadata({
      ...sample,
      sampleRef: slot.sampleRef || slot.id,
      filename: sample.filename,
    });
    if (slot.slotId === 'sample' && typeof module.setSampleMetadata === 'function') {
      module.fileName = sample.filename;
      module.setSampleMetadata(metadata);
    } else if (typeof module.assignPad === 'function') {
      module.assignPad(slot.slotId, { fileName: sample.filename });
    } else if (Array.isArray(module.zones)) {
      const existing = module.zones.find(
        (zone) => zone.rootNote === slot.slotId || zone.name === slot.filename
      );
      if (existing) existing.name = sample.filename;
      else
        module.zones.push({ name: sample.filename, rootNote: slot.slotId || 'C4', buffer: null });
      module.render?.();
    }
    this.renderSamplePanels();
    this.renderWorkspaceView();
    this.publishProjectChange('sample-assigned');
    this.logText(
      `assigned ${sample.filename} to ${slot.moduleTitle} / ${slot.slotLabel || slot.slotId}`
    );
    return true;
  }

  escapeHtml(value = '') {
    return String(value).replace(
      /[&<>"]/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]
    );
  }

  async importSampleLibraryFiles(files) {
    const imported = [];
    for (const file of Array.from(files || [])) {
      imported.push(
        this.sampleLibrary.addSample('/uploads', {
          filename: file.name,
          sampleLengthMs: 0,
          type: file.type || 'application/octet-stream',
          bytes: new Uint8Array(await file.arrayBuffer()),
        })
      );
    }
    this.sampleLibrary.save();
    const targetSlotId = this.pendingSampleUploadSlotId;
    this.pendingSampleUploadSlotId = null;
    if (targetSlotId && imported[0]) {
      this.selectedSampleId = imported[0].id;
      this.assignSelectedSampleToSlot(targetSlotId);
    } else {
      this.renderSamplePanels();
    }
    this.logText(`global sample library imported ${Array.from(files || []).length} file(s)`);
  }

  async importSampleLibraryJsonFile(file) {
    try {
      this.sampleLibrary.importSnapshot(JSON.parse(await file.text())).save();
      document.querySelector('#sampleLibraryJson').value = this.sampleLibrary.exportJson();
      this.renderSamplePanels();
      this.logText(`global sample library JSON loaded: ${file.name}`);
    } catch (error) {
      this.logText(`sample library import failed: ${error.message}`);
    }
  }

  exportSampleLibraryJson() {
    const text = this.sampleLibrary.exportJson();
    document.querySelector('#sampleLibraryJson').value = text;
    this.logText('global sample library JSON exported');
  }

  exportComposedSoundscapePresets() {
    const text = exportComposedPresetBankJson();
    document.querySelector('#composedSoundscapePresetJson').value = text;
    this.logText('composed soundscape preset bank exported');
  }

  renderSamplePanels() {
    this.renderSampleLibraryTree();
    this.renderProjectSampleUsage();
    if (this.workspaceView === 'samples') this.renderWorkspaceView();
  }

  renderSampleLibraryTree() {
    const root = document.querySelector('#sampleLibraryTree');
    if (!root) return;
    root.innerHTML = renderSampleLibraryTreeHtml(this.sampleLibrary.root);
  }

  renderProjectSampleUsage() {
    const root = document.querySelector('#missingSampleSlots');
    if (!root) return;
    const project = this.serializeRig();
    const usage = detectProjectSampleUsage(project, this.sampleLibrary).map((slot) => {
      const progress = this.sampleSyncProgress.get(slot.id)?.progress;
      return progress !== undefined
        ? { ...slot, availability: progress >= 1 ? 'available' : 'syncing', progress }
        : slot;
    });
    root.innerHTML = renderProjectSampleUsageHtml(usage);
  }

  sendSampleSyncPacket(packet) {
    this.subLobby?.subLobby?.broadcast?.({ type: packet.type, payload: packet.payload });
  }

  handleSubLobbySampleData(_from, data = {}) {
    if (data.type === SAMPLE_PACKET_TYPES.request) {
      const sample =
        this.sampleLibrary.findSample(data.payload?.sampleRef) ||
        this.sampleLibrary.findSample(data.payload?.filename);
      if (!sample) return;
      const bytes =
        sample.bytes instanceof Uint8Array ? sample.bytes : Uint8Array.from(sample.bytes || []);
      this.subLobby?.subLobby?.broadcast?.({
        type: SAMPLE_PACKET_TYPES.start,
        payload: {
          slotId: data.payload.slotId,
          sampleRef: data.payload.sampleRef || sample.sampleRef,
          filename: sample.filename,
          totalBytes: bytes.length,
          metadata: { ...sample, bytes: undefined },
        },
      });
      if (bytes.length) {
        this.subLobby?.subLobby?.broadcast?.({
          type: SAMPLE_PACKET_TYPES.complete,
          payload: { slotId: data.payload.slotId, bytes: Array.from(bytes) },
        });
      }
      this.logText(`served sample to sub-lobby: ${sample.filename}`);
    }
    if (data.type === SAMPLE_PACKET_TYPES.start) this.sampleSync.receiveSampleStart(data.payload);
    if (data.type === SAMPLE_PACKET_TYPES.chunk) {
      this.sampleSync.receiveSampleChunk({
        ...data.payload,
        bytes: Uint8Array.from(data.payload?.bytes || []),
      });
    }
    if (data.type === SAMPLE_PACKET_TYPES.complete) {
      this.sampleSync.receiveSampleComplete({
        ...data.payload,
        bytes: Uint8Array.from(data.payload?.bytes || []),
      });
    }
  }

  syncModuleMetadataToSampleLibrary({ moduleId, metadata } = {}) {
    const sample = this.sampleLibrary.addSample('/module-metadata', {
      ...normalizeSampleMetadata(metadata || {}),
      sampleRef: metadata?.sampleRef || `${moduleId}/sample`,
    });
    this.sampleLibrary.save();
    this.renderSamplePanels();
    this.logText(`synced sampler metadata to global library: ${sample.filename}`);
  }

  async bootstrapDefaultRig() {
    const rig = createDefaultPeerDawRig(this.runtime);
    this.mixer = rig.master;
    this.clock = rig.clock;
    const { ocra, synth, sampler, drumSampler, drumPianoRoll, field, peer } = rig;

    for (const module of [
      this.mixer,
      this.clock,
      ocra,
      synth,
      sampler,
      drumSampler,
      drumPianoRoll,
      field,
      peer,
    ]) {
      await this.addModule(module, { autoConnectAudio: true });
    }

    // Default routing
    this.patchBay.connect(
      { moduleId: this.clock.id, outputId: 'clock' },
      { moduleId: ocra.id, inputId: 'clock' }
    );
    this.patchBay.connect(
      { moduleId: ocra.id, outputId: 'midi' },
      { moduleId: synth.id, inputId: 'midi' }
    );
    this.patchBay.connect(
      { moduleId: ocra.id, outputId: 'midi' },
      { moduleId: sampler.id, inputId: 'midi' }
    );
    this.patchBay.connect(
      { moduleId: this.clock.id, outputId: 'clock' },
      { moduleId: drumPianoRoll.id, inputId: 'clock' }
    );
    this.patchBay.connect(
      { moduleId: drumPianoRoll.id, outputId: 'midi' },
      { moduleId: drumSampler.id, inputId: 'midi' }
    );
    this.patchBay.connect(
      { moduleId: drumPianoRoll.id, outputId: 'control' },
      { moduleId: drumSampler.id, inputId: 'control' }
    );
    this.patchBay.connect(
      { moduleId: synth.id, outputId: 'midi' },
      { moduleId: peer.id, inputId: 'midi' }
    );

    this.renderRoutes();
  }

  autoJoinFromUrl() {
    if (
      this.urlParams.get('multiplayer') !== 'true' &&
      !this.targetPeerId &&
      !this.spectateMode
    )
      return;
    const username =
      this.urlParams.get('username') || document.querySelector('#pilotName')?.value || 'pilot';
    const pilotEl = document.querySelector('#pilotName');
    if (pilotEl) pilotEl.value = username;
    this.subLobby.setUsername(username);
    this.subLobby
      .connect()
      .catch((error) => this.logText(`app-hub lobby failed: ${error.message}`));
    const target = this.targetPeerId ? ` for ${this.targetPeerId}` : '';
    this.logText(`${this.spectateMode ? 'observing' : 'joining'} peer session${target}`);
  }

  bindPeernetStack() {
    this.subLobby.on('state', (state) => this.updateSubLobbyUI(state));
    this.subLobby.on('offer', (offer) => {
      this.logText(
        offer.joinBlocked
          ? `sub-lobby offer blocked by ${offer.hostName || 'host'}`
          : `joining sub-lobby from ${offer.hostName || 'host'}`
      );
    });
    this.subLobby.on('project', ({ reason }) => this.logText(`remote project applied: ${reason}`));
    this.subLobby.on('data', ({ from, data }) => this.handleSubLobbySampleData(from, data));
    this.peernet.onMessage(PROJECT_SYNC_CHANNEL, (message, meta) =>
      this.handleProjectSyncMessage(message, {
        transport: 'peernet',
        peerId: meta.peerId,
        receivedAt: meta.receivedAt,
      })
    );

    this.peernet.addEventListener('status', (e) => {
      const health = e.detail.health || this.peernet.health();
      this.renderPeernetHealth(health);
      this.handlePeernetProjectSyncHealth(health);
    });
    this.peernet.addEventListener('health', (e) => {
      this.renderPeernetHealth(e.detail);
      this.handlePeernetProjectSyncHealth(e.detail);
    });
    this.peernet.addEventListener('presence', (e) => {
      const previousPeerCount = this.peerList.length;
      this.peerList = e.detail;
      this.updateSessionUI();
      if (
        this.peerList.length > previousPeerCount &&
        ['requesting', 'unsynced', 'local-only', 'remote-only'].includes(this.localSyncStatus)
      ) {
        this.requestLocalSessionProject({ force: true });
      }
    });
    this.peernet.addEventListener('storage', (e) => {
      document.querySelector('#storageStatus').textContent =
        `last save: ${new Date(e.detail.createdAt).toLocaleTimeString()}`;
    });
    this.peernet.addEventListener('packet', (e) => {
      const packet = e.detail?.packet;
      if (packet) this.logText(`remote packet: ${packet.kind}/${packet.type}`);
    });
  }

  bindPatchCanvas() {
    // Initialize patch canvas if available
    if (typeof PatchCanvas === 'function') {
      this.patchCanvas = new PatchCanvas(this.patchCanvasEl, this.routingGraph, {
        onChange: () => this.handlePatchGraphChange(),
      });
    }
  }

  async addModule(module, { autoConnectAudio = false } = {}) {
    this.patchBay.addModule(module);
    this.routingGraph.addNode(module.id, { title: module.title, kind: module.kind });
    this.renderPatchCanvas();

    const card = document.createElement('article');
    const chainId = this.chainIdForModule(module.id);
    card.className = `module-card kind-${module.kind} ${chainId && chainId === this.selectedChainId ? 'selected-chain-module' : ''}`;
    card.dataset.moduleId = module.id;
    card.innerHTML = `<div class="module-actions"><button class="remove" title="remove module">Remove</button><button class="focus" title="focus module">Focus</button></div>${this.moduleChainBadgeHtml(module)}<div class="mount"></div>`;
    this.modulesEl.appendChild(card);
    module.mount(card.querySelector('.mount'));
    module.addEventListener?.('sample-library-sync', (event) =>
      this.syncModuleMetadataToSampleLibrary(event.detail)
    );
    card.querySelector('.remove').addEventListener('click', () => this.removeModule(module.id));
    card.querySelector('.focus').addEventListener('click', () => {
      this.focusedModuleId = module.id;
      this.refreshFocusedModuleCard();
      this.setWorkspaceView('module');
    });

    if (this.runtime.context) await module.start(this.runtime.context);
    if (
      autoConnectAudio &&
      module.outputs.some((p) => p.type === PortType.AUDIO) &&
      module !== this.mixer
    ) {
      this.routingGraph.connect(module.id, 'destination', 'audio');
      this.syncAudioGraph();
      this.renderPatchCanvas();
      this.addMixerStrip(module);
    }

    this.updateStats();
    this.renderWorkspaceView();
    this.publishProjectChange('module-added');
  }

  async startAudioModules() {
    for (const module of this.patchBay.modules.values()) {
      await module.start?.(this.runtime.context);
    }
    this.syncAudioGraph();
  }

  removeModule(moduleId) {
    document.querySelector(`[data-module-id="${CSS.escape(moduleId)}"]`)?.remove();
    document.querySelector(`[data-strip-id="${CSS.escape(moduleId)}"]`)?.remove();
    this.patchBay.removeModule(moduleId);
    this.routingGraph.removeNode(moduleId);
    this.syncAudioGraph();
    this.renderPatchCanvas();
    this.renderRoutes();
    this.updateStats();
    this.renderWorkspaceView();
    this.publishProjectChange('module-removed');
  }

  autopatch(module) {
    if (module.inputs.some((p) => p.type === PortType.MIDI)) {
      const generators = [...this.patchBay.modules.values()].filter(
        (m) => m.kind === 'midi-generator' || m.outputs.some((p) => p.type === PortType.MIDI)
      );
      if (generators.length > 0) {
        this.patchBay.connect(
          { moduleId: generators[0].id, outputId: 'midi' },
          { moduleId: module.id, inputId: 'midi' }
        );
      }
    }
    if (module.inputs.some((p) => p.type === PortType.CLOCK)) {
      if (this.clock) {
        this.patchBay.connect(
          { moduleId: this.clock.id, outputId: 'clock' },
          { moduleId: module.id, inputId: 'clock' }
        );
      }
    }
  }

  addMixerStrip(module) {
    if (this.mixerStripEl.querySelector(`[data-strip-id="${CSS.escape(module.id)}"]`)) return;
    const strip = document.createElement('div');
    strip.className = 'strip';
    strip.dataset.stripId = module.id;
    strip.innerHTML = `
      <strong title="${this.escapeHtml(module.title)}">${this.escapeHtml(module.title)}</strong>
      <small>${this.escapeHtml(module.kind)}</small>
      <input type="range" min="0" max="100" value="70">
    `;
    const slider = strip.querySelector('input');
    slider.addEventListener('input', () => {
      if (module.output?.gain) module.output.gain.value = Number(slider.value) / 100;
    });
    this.mixerStripEl.appendChild(strip);
  }

  renderRoutes() {
    const packetRoutes = this.patchBay.routes
      .map(
        (route) => `
      <li><code>${this.escapeHtml(route.from.moduleId)}:${this.escapeHtml(route.from.outputId)}</code> → <code>${this.escapeHtml(route.to.moduleId)}:${this.escapeHtml(route.to.inputId)}</code></li>
    `
      )
      .join('');
    const audioRoutes = this.routingGraph.edges
      .filter((edge) => edge.type === 'audio')
      .map(
        (edge) => `
      <li><code>${this.escapeHtml(edge.from)}:audio</code> ⇢ <code>${this.escapeHtml(edge.to)}:audio</code></li>
    `
      )
      .join('');
    this.routesEl.innerHTML =
      [
        packetRoutes && '<li class="dim">packet routes</li>',
        packetRoutes,
        audioRoutes && '<li class="dim">audio graph</li>',
        audioRoutes,
      ]
        .filter(Boolean)
        .join('') || '<li class="dim">no routes yet</li>';
    this.updateStats();
  }

  renderPatchCanvas() {
    if (this.patchCanvas) {
      this.patchCanvas.render();
    }
  }

  updateStats() {
    const audioRouteCount = this.routingGraph.edges.filter((edge) => edge.type === 'audio').length;
    document.querySelector('#moduleCount').textContent = `${this.patchBay.modules.size} modules`;
    document.querySelector('#routeCount').textContent =
      `${this.patchBay.routes.length} packet / ${audioRouteCount} audio routes`;
    this.updateTransportStats();
  }

  handlePatchGraphChange() {
    this.syncAudioGraph();
    this.renderRoutes();
    this.refreshModuleChainBadges();
    this.updateStats();
    this.renderWorkspaceView();
    this.publishProjectChange('patch-graph-change');
  }

  async replaceWithPianoRoll(moduleId, pianoRollConfig) {
    const existingRoutes = this.patchBay.routes.filter(
      (route) => route.from.moduleId === moduleId || route.to.moduleId === moduleId
    );
    this.removeModule(moduleId);
    const pianoRoll = moduleFactories.pianoroll();
    pianoRoll.id = pianoRollConfig.id;
    pianoRoll.title = pianoRollConfig.title;
    pianoRoll.hydrate?.(pianoRollConfig);
    await this.addModule(pianoRoll, { autoConnectAudio: false });
    for (const route of existingRoutes) {
      const rewritten = {
        from: {
          ...route.from,
          moduleId: route.from.moduleId === moduleId ? pianoRoll.id : route.from.moduleId,
        },
        to: {
          ...route.to,
          moduleId: route.to.moduleId === moduleId ? pianoRoll.id : route.to.moduleId,
        },
      };
      this.patchBay.connect(rewritten.from, rewritten.to);
    }
    this.renderRoutes();
    this.renderPatchCanvas();
    this.logText(`converted ${moduleId} to piano roll`);
  }

  logPacket({ from, outputId, packet }) {
    if (packet.kind === PortType.CONTROL && packet.type === 'replace-module') {
      this.replaceWithPianoRoll(packet.target || from, packet.value);
      return;
    }
    this.peernet.broadcastPacket(packet, outputId);
    if (packet.kind === PortType.CLOCK) return;
    const row = document.createElement('div');
    row.className = `packet ${packet.kind}`;
    row.textContent = `${from}:${outputId} :: ${packet.kind}/${packet.type}${packet.note ? ` ${packet.note}` : ''}`;
    this.logEl.prepend(row);
    while (this.logEl.children.length > 50) this.logEl.lastChild.remove();
  }

  logText(text) {
    const row = document.createElement('div');
    row.className = 'packet control';
    row.textContent = text;
    this.logEl.prepend(row);
    while (this.logEl.children.length > 30) this.logEl.lastChild.remove();
  }

  syncAudioGraph() {
    if (!this.runtime.destination) return;
    if (!this.graphSync) {
      this.graphSync = new AudioGraphSync({
        modules: this.patchBay.modules,
        destination: this.runtime.destination,
      });
    }
    this.graphSync.modules = this.patchBay.modules;
    this.graphSync.destination = this.runtime.destination;
    this.graphSync.apply(this.routingGraph);
  }

  projectSnapshotInput() {
    return {
      modules: [...this.patchBay.modules.values()],
      routes: this.patchBay.routes,
      clipState: this.serializeClipState(),
      arrangement: this.arrangement,
      mixerState: this.mixerState,
      routingGraph: this.routingGraph,
      patchCanvas: this.patchCanvas,
    };
  }

  projectSource() {
    return createProjectSource(this.projectSnapshotInput());
  }

  serializeRig() {
    return serializeRigSnapshot(this.projectSnapshotInput());
  }

  selectedProjectExportMode() {
    return document.querySelector('#projectExportMode')?.value || 'just-project';
  }

  async createProjectExport(mode = this.selectedProjectExportMode()) {
    return createProjectPackage(this.projectSource(), { mode });
  }

  async copyProject() {
    const pkg = await this.createProjectExport();
    document.querySelector('#projectIoText').value = pkg.text;
    try {
      await navigator.clipboard?.writeText?.(pkg.text);
      this.logText(`project copied: ${pkg.mode}`);
    } catch {
      this.logText(`project export ready in text area: ${pkg.mode}`);
    }
  }

  async pasteProject() {
    const field = document.querySelector('#projectIoText');
    const clipboardText = await navigator.clipboard?.readText?.().catch(() => '');
    const text = clipboardText || field.value;
    field.value = text;
    try {
      this.applyRig(parseProjectPayload(text));
    } catch (error) {
      this.logText(`project paste failed: ${error.message}`);
    }
  }

  async importProjectFile(file) {
    try {
      const payload = file.name.endsWith('.zip') ? await file.arrayBuffer() : await file.text();
      this.applyRig(parseProjectPayload(payload));
      this.logText(`project imported: ${file.name}`);
    } catch (error) {
      this.logText(`project import failed: ${error.message}`);
    }
  }

  async downloadProject() {
    const pkg = await this.createProjectExport();
    const blob = new Blob([pkg.bytes || pkg.text], { type: pkg.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = pkg.filename;
    link.click();
    URL.revokeObjectURL(url);
    document.querySelector('#projectIoText').value = pkg.text;
    this.logText(`project downloaded: ${pkg.filename}`);
  }

  async applyRemoteProject(project) {
    this.suppressProjectBroadcast = true;
    try {
      await this.rebuildRigFromProject(project);
    } finally {
      this.suppressProjectBroadcast = false;
    }
  }

  publishProjectChange(reason = 'local-change') {
    if (this.suppressProjectBroadcast) return;
    this.subLobby.publishProjectChange(this.serializeRig(), reason);
    this.publishLocalSessionProject(reason);
  }

  async rebuildRigFromProject(project) {
    const wasSuppressed = this.suppressProjectBroadcast;
    this.suppressProjectBroadcast = true;
    try {
      for (const module of [...this.patchBay.modules.values()]) this.removeModule(module.id);
      this.patchBay.routes = [];
      this.routingGraph = new RoutingGraph();
      this.bindPatchCanvas();
      this.mixer = null;
      this.clock = null;
      this.restoreClipState(project);
      this.restoreMixerState(project);

      for (const moduleData of project.modules || []) {
        const type = moduleData.moduleType || moduleData.kind;
        const factory =
          moduleFactories[type] || moduleFactories[moduleData.kind] || moduleFactories.synth;
        const module = factory();
        module.id = moduleData.id || module.id;
        module.title = moduleData.title || module.title;
        module.hydrate?.(moduleData);
        if (module.kind === 'clock') this.clock = module;
        if (type === 'master' || moduleData.id === 'main-mixer') this.mixer = module;
        await this.addModule(module, { autoConnectAudio: true });
      }

      this.patchBay.routes = Array.from(project.routes || []);
      this.restoreRoutingGraphState(project);
      this.patchCanvas?.restorePositions?.(project.canvasPositions || {});
      this.renderRoutes();
      this.refreshModuleChainBadges();
      this.renderPatchCanvas();
      this.ensureDefaultClipSlots();
      this.updateStats();
      this.renderWorkspaceView();
    } finally {
      this.suppressProjectBroadcast = wasSuppressed;
    }
    if (!this.suppressProjectBroadcast) this.publishProjectChange('project-rebuilt');
  }

  restoreRoutingGraphState(project = {}) {
    const graph = project.graph || null;
    if (graph) {
      this.routingGraph.clearEdges();
      for (const node of graph.nodes || []) {
        if (node?.id) this.routingGraph.addNode(node.id, node);
      }
      for (const edge of graph.edges || []) {
        if (edge?.from && edge?.to)
          this.routingGraph.connect(edge.from, edge.to, edge.type || 'audio');
      }
      this.routingGraph.chains.clear();
      for (const [channelId, effects] of graph.chains || []) {
        this.routingGraph.setChain(channelId, effects);
      }
      return;
    }
    for (const route of this.patchBay.routes) {
      this.routingGraph.connect(route.from.moduleId, route.to.moduleId, route.from.outputId);
    }
  }

  applyRig(payload) {
    this.rebuildRigFromProject(payload).catch((error) =>
      this.logText(`project import failed: ${error.message}`)
    );
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.v11PeerDAW = new V11PeerDAW();
  window.v11PeerDAW.init();
});
