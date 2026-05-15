// V11 Peer DAW/src/app.js
// Main application module

import { AudioGraphSync } from './core/audio-graph-sync.js';
import { AudioRuntime } from './core/audio.js';
import { PortType } from './core/contracts.js';
import { PatchBay } from './core/patchbay.js';
import { PeernetStack } from './core/peernet-stack.js';
import {
  SAMPLE_PACKET_TYPES,
  SampleLibrary,
  SampleSyncManager,
  detectProjectSampleUsage,
  normalizeSampleMetadata,
} from './core/sample-library.js';
import { SubLobbyManager } from './core/sub-lobby-manager.js';
import { PeernetLobby } from '../../peernetjs/peernet-lib.js';
import { createProjectPackage, parseProjectPayload } from './core/project-io.js';
import { RoutingGraph } from './core/routing-graph.js';
import { createDefaultPeerDawRig, moduleFactories } from './modules/catalog.js';
import { PatchCanvas } from './ui/patch-canvas.js';

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
    this.clock = null;
    this.mixer = null;
    this.peernet = new PeernetStack({
      namespace: 'v11-peer-daw',
      capture: () => this.serializeRig(),
      apply: (payload) => this.applyRig(payload),
    });

    // Session state
    this.urlParams = new URLSearchParams(window.location.search);
    this.sessionCode = this.urlParams.get('session') || null;
    this.targetPeerId = this.urlParams.get('targetPeerId') || '';
    this.spectateMode = this.urlParams.get('spectate') === 'true' || this.urlParams.get('observe') === 'true';
    this.peerList = [];
    this.suppressProjectBroadcast = false;
    this.sampleLibrary = new SampleLibrary();
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

  async init() {
    this.createStarfield();
    this.bindChrome();
    this.patchBay.addEventListener('packet', (e) => this.logPacket(e.detail));
    this.patchBay.addEventListener('route:add', () => this.renderRoutes());
    this.bindPatchCanvas();
    this.bindPeernetStack();
    await this.bootstrapDefaultRig();
    this.sampleLibrary.load();
    this.bindSampleLibrary();
    this.renderSamplePanels();
    this.autoJoinFromUrl();
  }

  createStarfield() {
    const root = document.querySelector('#starfield');
    root.innerHTML = Array.from({ length: 120 }, (_, _i) => {
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const s = 1 + Math.random() * 2;
      const d = 1.5 + Math.random() * 4;
      const opacity = 0.3 + Math.random() * 0.7;
      return `<i style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-duration:${d}s;--opacity:${opacity}"></i>`;
    }).join('');
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
    });

    document.querySelector('#btnConnectPeer').addEventListener('click', async () => {
      const username = document.querySelector('#pilotName').value || 'pilot';
      this.subLobby.setUsername(username);
      await this.subLobby.connect();
      this.peernet.start({
        username,
        targetPeerId: this.targetPeerId,
        spectate: this.spectateMode,
        sessionCode: this.sessionCode,
      });
      this.logText('visible in app-hub lobby as V11 DAW');
    });

    document.querySelector('#btnCreateSession').addEventListener('click', () => {
      const session = this.peernet.createSession('V11 Peer DAW Session');
      if (session) {
        this.sessionCode = session.code;
        this.updateSessionUI();
        this.logText(`session created: ${session.title}`);
      }
    });

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

    document.querySelector('#sampleLibraryUploadFile')?.addEventListener('change', async (event) => {
      await this.importSampleLibraryFiles(event.target.files || []);
      event.target.value = '';
    });
    document.querySelector('#sampleLibraryImportFile')?.addEventListener('change', async (event) => {
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
      this.sampleLibrary.importSnapshot(JSON.parse(text)).save();
      this.renderSamplePanels();
      this.logText('global sample library JSON imported');
    });
  }

  updateSessionUI() {
    const codeEl = document.querySelector('#sessionCode');
    const listEl = document.querySelector('#peerList');

    if (this.sessionCode) {
      codeEl.textContent = this.sessionCode;
    }

    if (this.peerList.length > 0) {
      listEl.innerHTML = this.peerList
        .map(
          (p) => `<div class="peer-item"><span class="peer-dot"></span>${p.name || 'peer'}</div>`
        )
        .join('');
    }
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
      const room = state.subLobbyId ? state.subLobbyId.replace('v11-peer-daw-sublobby-', '') : 'none';
      statusEl.textContent = `sub-lobby: ${state.role} · ${room} · ${state.joinBlocked ? 'blocked' : 'open'}`;
    }
    if (listEl) {
      const peers = [...(state.subLobbyPeers || new Map()).entries()];
      listEl.innerHTML = peers.length
        ? peers
            .map(
              ([id, peer]) =>
                `<div class="peer-item"><span class="peer-dot"></span>${peer.username || id}</div>`
            )
            .join('')
        : '<div class="peer-item dim">no sub-lobby peers yet</div>';
    }
    document.querySelector('#peerCount').textContent = `${state.peers?.size || 0} hub peers`;
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
      if (!button) return;
      const slot = button.closest('[data-sample-slot]');
      const slotId = slot?.dataset.sampleSlot || '';
      const sampleRef = slot?.dataset.sampleRef || slotId;
      const filename = slot?.dataset.filename || '';
      if (button.dataset.sampleAction === 'query-peer') {
        this.sampleSync.requestSample({ slotId, sampleRef, filename, peerId: '' });
        this.sampleSyncProgress.set(slotId, { slotId, sampleRef, filename, progress: 0.05 });
        this.renderProjectSampleUsage();
        this.logText(`sample query requested: ${filename || sampleRef}`);
      }
      if (button.dataset.sampleAction === 'pick-upload') {
        document.querySelector('#sampleLibraryUploadFile')?.click();
      }
    });
  }

  escapeHtml(value = '') {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  }

  async importSampleLibraryFiles(files) {
    for (const file of Array.from(files || [])) {
      this.sampleLibrary.addSample('/uploads', {
        filename: file.name,
        sampleLengthMs: 0,
        type: file.type || 'application/octet-stream',
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
    this.sampleLibrary.save();
    this.renderSamplePanels();
    this.logText(`global sample library imported ${Array.from(files || []).length} file(s)`);
  }

  async importSampleLibraryJsonFile(file) {
    this.sampleLibrary.importSnapshot(JSON.parse(await file.text())).save();
    document.querySelector('#sampleLibraryJson').value = this.sampleLibrary.exportJson();
    this.renderSamplePanels();
    this.logText(`global sample library JSON loaded: ${file.name}`);
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
  }

  renderSampleLibraryTree() {
    const root = document.querySelector('#sampleLibraryTree');
    if (!root) return;
    const renderDir = (dir, depth = 0) => {
      const sampleRows = (dir.samples || [])
        .map(
          (sample) =>
            `<div class="sample-library-sample" draggable="true" data-sample-id="${this.escapeHtml(sample.id)}" style="margin-left:${depth * 10}px"><strong>${this.escapeHtml(sample.filename)}</strong><small>${this.escapeHtml(sample.sampleLengthMs || 0)}ms · ${this.escapeHtml(sample.type || sample.mime || 'audio')}</small><span class="pill">${this.escapeHtml(sample.source || 'local')}</span></div>`
        )
        .join('');
      const childRows = (dir.dirs || []).map((child) => renderDir(child, depth + 1)).join('');
      const label = dir.name === 'root' ? 'library' : dir.name;
      return `<div class="sample-library-dir" style="margin-left:${depth * 8}px"><strong>/${this.escapeHtml(label)}</strong>${sampleRows}${childRows}</div>`;
    };
    root.innerHTML = renderDir(this.sampleLibrary.root);
  }

  renderProjectSampleUsage() {
    const root = document.querySelector('#missingSampleSlots');
    if (!root) return;
    const project = this.serializeRig();
    const usage = detectProjectSampleUsage(project, this.sampleLibrary).map((slot) => {
      const progress = this.sampleSyncProgress.get(slot.id)?.progress;
      return progress !== undefined ? { ...slot, availability: progress >= 1 ? 'available' : 'syncing', progress } : slot;
    });
    if (!usage.length) {
      root.innerHTML = '<p class="microcopy">No project sample references yet.</p>';
      return;
    }
    root.innerHTML = usage
      .map((slot) => {
        const progress = Math.round((slot.progress ?? (slot.availability === 'missing' ? 0 : 1)) * 100);
        return `<article class="sample-slot-card state-${this.escapeHtml(slot.availability)}" data-sample-slot="${this.escapeHtml(slot.id)}" data-sample-ref="${this.escapeHtml(slot.sampleRef)}" data-filename="${this.escapeHtml(slot.filename)}" style="--sample-fill:${progress}%"><div class="sample-slot-fill"></div><strong>${this.escapeHtml(slot.filename)}</strong><small>${this.escapeHtml(slot.moduleTitle)} · ${this.escapeHtml(slot.sampleRef)}</small><span class="pill">${this.escapeHtml(slot.availability)}</span><span class="microcopy">${this.escapeHtml(slot.sampleLengthMs || '?')}ms · ${this.escapeHtml(slot.type || 'unknown type')}</span><div class="button-row"><button type="button" data-sample-action="query-peer">QUERY PEERS</button><button type="button" data-sample-action="pick-upload">UPLOAD / REPLACE</button></div></article>`;
      })
      .join('');
  }

  sendSampleSyncPacket(packet) {
    this.subLobby?.subLobby?.broadcast?.({ type: packet.type, payload: packet.payload });
  }

  handleSubLobbySampleData(from, data = {}) {
    if (data.type === SAMPLE_PACKET_TYPES.request) {
      const sample =
        this.sampleLibrary.findSample(data.payload?.sampleRef) ||
        this.sampleLibrary.findSample(data.payload?.filename);
      if (!sample) return;
      const bytes = sample.bytes instanceof Uint8Array ? sample.bytes : Uint8Array.from(sample.bytes || []);
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
    if (this.urlParams.get('multiplayer') !== 'true' && !this.targetPeerId && !this.sessionCode)
      return;
    const username =
      this.urlParams.get('username') || document.querySelector('#pilotName')?.value || 'pilot';
    document.querySelector('#pilotName').value = username;
    this.subLobby.setUsername(username);
    this.subLobby.connect().catch((error) => this.logText(`app-hub lobby failed: ${error.message}`));
    this.peernet.start({
      username,
      targetPeerId: this.targetPeerId,
      spectate: this.spectateMode,
      sessionCode: this.sessionCode,
    });
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

    this.peernet.addEventListener('status', (e) => {
      document.querySelector('#peerStatus').textContent = e.detail.text;
    });
    this.peernet.addEventListener('presence', (e) => {
      this.peerList = e.detail;
      document.querySelector('#peerCount').textContent = `${e.detail.length} peers`;
      this.updateSessionUI();
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
    card.className = `module-card kind-${module.kind}`;
    card.dataset.moduleId = module.id;
    card.innerHTML =
      '<button class="remove" title="remove module">×</button><div class="mount"></div>';
    this.modulesEl.appendChild(card);
    module.mount(card.querySelector('.mount'));
    module.addEventListener?.('sample-library-sync', (event) => this.syncModuleMetadataToSampleLibrary(event.detail));
    card.querySelector('.remove').addEventListener('click', () => this.removeModule(module.id));

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
    this.publishProjectChange('module-added');
  }

  async startAudioModules() {
    for (const module of this.patchBay.modules.values()) {
      await module.start?.(this.runtime.context);
    }
    this.syncAudioGraph();
  }

  removeModule(moduleId) {
    document.querySelector(`[data-module-id="${moduleId}"]`)?.remove();
    document.querySelector(`[data-strip-id="${moduleId}"]`)?.remove();
    this.patchBay.removeModule(moduleId);
    this.routingGraph.removeNode(moduleId);
    this.syncAudioGraph();
    this.renderPatchCanvas();
    this.renderRoutes();
    this.updateStats();
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
    if (this.mixerStripEl.querySelector(`[data-strip-id="${module.id}"]`)) return;
    const strip = document.createElement('div');
    strip.className = 'strip';
    strip.dataset.stripId = module.id;
    strip.innerHTML = `
      <strong title="${module.title}">${module.title}</strong>
      <small>${module.kind}</small>
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
      <li><code>${route.from.moduleId}:${route.from.outputId}</code> → <code>${route.to.moduleId}:${route.to.inputId}</code></li>
    `
      )
      .join('');
    const audioRoutes = this.routingGraph.edges
      .filter((edge) => edge.type === 'audio')
      .map(
        (edge) => `
      <li><code>${edge.from}:audio</code> ⇢ <code>${edge.to}:audio</code></li>
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
  }

  handlePatchGraphChange() {
    this.syncAudioGraph();
    this.renderRoutes();
    this.updateStats();
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
    const row = document.createElement('div');
    row.className = `packet ${packet.kind}`;
    row.textContent = `${from}:${outputId} :: ${packet.kind}/${packet.type}${packet.note ? ` ${packet.note}` : ''}`;
    this.logEl.prepend(row);
    while (this.logEl.children.length > 30) this.logEl.lastChild.remove();
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

  projectSource() {
    return {
      modules: [...this.patchBay.modules.values()],
      routes: this.patchBay.routes,
    };
  }

  serializeRig() {
    return {
      version: 1,
      modules: [...this.patchBay.modules.values()].map(
        (module) =>
          module.serialize?.() || {
            id: module.id,
            kind: module.kind,
            title: module.title,
          }
      ),
      routes: this.patchBay.routes,
    };
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
    await navigator.clipboard?.writeText(pkg.text);
    this.logText(`project copied: ${pkg.mode}`);
  }

  async pasteProject() {
    const field = document.querySelector('#projectIoText');
    const clipboardText = await navigator.clipboard?.readText?.().catch(() => '');
    const text = clipboardText || field.value;
    field.value = text;
    this.applyRig(parseProjectPayload(text));
  }

  async importProjectFile(file) {
    const payload = file.name.endsWith('.zip') ? await file.arrayBuffer() : await file.text();
    this.applyRig(parseProjectPayload(payload));
    this.logText(`project imported: ${file.name}`);
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
  }

  async rebuildRigFromProject(project) {
    for (const module of [...this.patchBay.modules.values()]) this.removeModule(module.id);
    this.patchBay.routes = [];
    this.routingGraph = new RoutingGraph();
    this.bindPatchCanvas();
    this.mixer = null;
    this.clock = null;

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
    for (const route of this.patchBay.routes) {
      this.routingGraph.connect(route.from.moduleId, route.to.moduleId, route.from.outputId);
    }
    this.renderRoutes();
    this.renderPatchCanvas();
    this.updateStats();
    this.publishProjectChange('project-rebuilt');
  }

  applyRig(payload) {
    if (payload?.archiveBytes) {
      this.logText(
        'archive import detected; JSON project restore is available after extracting project.json'
      );
      return;
    }
    this.rebuildRigFromProject(payload).catch((error) =>
      this.logText(`project import failed: ${error.message}`)
    );
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.v11PeerDAW = new V11PeerDAW();
  window.v11PeerDAW.init();
});
