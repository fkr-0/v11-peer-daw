// V11 Peer DAW/src/app.js
// Main application module

import { AudioGraphSync } from './core/audio-graph-sync.js';
import { AudioRuntime } from './core/audio.js';
import { Arrangement, Clip, ClipSlot } from './core/clips-arrangement.js';
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
import { clonePeerDawExampleProject, peerDawExampleProjects } from './examples/peer-daw-example-projects.js';
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
    this.focusedModuleId = null;
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
    this.sessionCode = this.urlParams.get('session') || null;
    this.targetPeerId = this.urlParams.get('targetPeerId') || '';
    this.spectateMode = this.urlParams.get('spectate') === 'true' || this.urlParams.get('observe') === 'true';
    this.defaultSessionCode = this.urlParams.get('session') || 'V11-OPEN-STUDIO';
    this.peerList = [];
    this.workspaceView = 'session';
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
    this.bindExampleProjects();
    this.bindChrome();
    this.patchBay.addEventListener('packet', (e) => this.logPacket(e.detail));
    this.patchBay.addEventListener('route:add', () => this.renderRoutes());
    this.bindPatchCanvas();
    this.bindPeernetStack();
    await this.bootstrapDefaultRig();
    this.ensureDefaultClipSlots();
    this.sampleLibrary.load();
    this.bindSampleLibrary();
    this.renderSamplePanels();
    this.bindWorkspaceViews();
    this.renderWorkspaceView();
    await this.bootstrapDefaultPeernetSession();
    this.autoJoinFromUrl();
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
      await this.bootstrapDefaultPeernetSession({ force: true });
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

    document.querySelector('#btnWorkspaceReset')?.addEventListener('click', () => this.setWorkspaceView('session'));

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
      const moduleAction = event.target.closest('[data-module-action]');
      if (moduleAction) this.handleModuleAction(moduleAction.dataset.moduleAction, moduleAction);
    });
    workspace?.addEventListener('input', (event) => this.handleWorkspaceInput(event));
    workspace?.addEventListener('change', (event) => this.handleWorkspaceInput(event));
  }

  setWorkspaceView(view) {
    this.workspaceView = view || 'session';
    document.querySelectorAll('[data-workspace-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.workspaceView === this.workspaceView);
    });
    this.renderWorkspaceView();
  }

  workspaceModules() {
    return [...this.patchBay.modules.values()];
  }

  clipCapableModules() {
    return this.workspaceModules().filter(
      (module) =>
        module.inputs?.some((p) => p.type === PortType.CLOCK || p.type === PortType.MIDI) ||
        module.outputs?.some((p) => p.type === PortType.MIDI || p.type === PortType.CONTROL) ||
        ['sequencer', 'ocra', 'pianoroll'].includes(module.kind)
    );
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
    const slot = new ClipSlot({ channelId: normalizedModuleId, quantizationBeats: 4, clip, launchBeat, stopBeat });
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
    return {
      masterVolume: this.mixerState.masterVolume,
      channels: Object.fromEntries(
        Object.entries(this.mixerState.channels).map(([id, channel]) => [id, { ...channel }])
      ),
    };
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
    return {
      currentBeat: this.currentBeat,
      slots: this.clipSlots.map((slot) => ({
        id: slot.id,
        moduleId: slot.moduleId,
        name: slot.name,
        channelId: slot.channelId,
        quantizationBeats: slot.quantizationBeats,
        launchBeat: slot.launchBeat,
        stopBeat: slot.stopBeat,
        clip: slot.clip?.serialize?.() || null,
      })),
    };
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
    this.clipSlots = Array.from(clipState.slots || project.clipSlots || []).map((slot) => this.deserializeClipSlot(slot));
    this.clipSlotSequence = this.clipSlots.length + 1;
    this.arrangement = new Arrangement(project.arrangement || { loopStartBeat: 0, loopEndBeat: 16 });
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
    const placement = this.arrangement.placeClip({ clip: slot.clip, startBeat, trackId: slot.moduleId || slot.channelId });
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

  noteNames() {
    return ['C5','B4','A4','G4','F4','E4','D4','C4','B3','A3','G3','F3'];
  }

  renderPianoRollEditor(module) {
    const notes = Array.isArray(module.notes) ? module.notes : [];
    const noteNames = this.noteNames();
    const steps = Math.max(8, Math.min(64, module.steps || Math.ceil((module.lengthBeats || 4) / (module.stepResolutionBeats || 0.25))));
    const cells = noteNames.map((noteName) => `
      <div class="piano-note-label">${this.escapeHtml(noteName)}</div>
      ${Array.from({ length: steps }, (_, step) => {
        const hasNote = notes.some((note) => note.note === noteName && Math.round(note.beat / module.stepResolutionBeats) === step);
        return `<button type="button" class="piano-cell ${hasNote ? 'on' : ''}" data-module-action="toggle-note" data-module-id="${this.escapeHtml(module.id)}" data-note="${this.escapeHtml(noteName)}" data-step="${step}" title="${this.escapeHtml(noteName)} step ${step + 1}">${hasNote ? '●' : ''}</button>`;
      }).join('')}
    `).join('');
    const noteRows = notes.map((note) => `<div class="workspace-row"><strong>${this.escapeHtml(note.note)}</strong><span>beat ${this.escapeHtml(note.beat)}</span><label>Velocity <input data-module-input="note-velocity" data-module-id="${this.escapeHtml(module.id)}" data-note-id="${this.escapeHtml(note.id)}" type="range" min="0" max="1" step="0.01" value="${this.escapeHtml(note.velocity)}"></label></div>`).join('');
    return `<div class="piano-roll-editor"><div class="workspace-toolbar"><button type="button" data-module-action="add-note" data-module-id="${this.escapeHtml(module.id)}">ADD NOTE</button><button type="button" data-module-action="clear-notes" data-module-id="${this.escapeHtml(module.id)}">CLEAR NOTES</button><button type="button" data-module-action="apply-swing" data-module-id="${this.escapeHtml(module.id)}">APPLY SWING</button><span class="microcopy">${notes.length} notes · ${steps} steps · full-pane editor</span></div><div class="piano-grid" style="--steps:${steps}">${cells}</div><div class="workspace-list">${noteRows || '<p class="microcopy">No notes yet. Click grid cells or ADD NOTE.</p>'}</div></div>`;
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
    return this.workspaceModules().filter((module) => module.outputs?.some((p) => p.type === PortType.AUDIO) || module.inputs?.some((p) => p.type === PortType.AUDIO) || module === this.mixer);
  }

  renderMixerEditor() {
    const strips = this.mixerModules();
    const rows = strips.map((module) => {
      const channel = this.ensureMixerChannel(module);
      return `<article class="mixer-channel ${channel.muted ? 'muted' : ''} ${channel.solo ? 'solo' : ''}"><strong>${this.escapeHtml(channel.title || module.title)}</strong><small>${this.escapeHtml(module.kind)} · ${this.escapeHtml(module.id)}</small><label>Level <input data-module-input="mixer-gain" data-module-id="${this.escapeHtml(module.id)}" type="range" min="0" max="1.5" step="0.01" value="${this.escapeHtml(channel.gain)}"></label><label>Pan <input data-module-input="mixer-pan" data-module-id="${this.escapeHtml(module.id)}" type="range" min="-1" max="1" step="0.01" value="${this.escapeHtml(channel.pan)}"></label><div class="button-row"><button type="button" data-module-action="toggle-mute" data-module-id="${this.escapeHtml(module.id)}">${channel.muted ? 'UNMUTE' : 'MUTE'}</button><button type="button" data-module-action="toggle-solo" data-module-id="${this.escapeHtml(module.id)}">${channel.solo ? 'UNSOLO' : 'SOLO'}</button><button type="button" data-module-action="focus-module" data-module-id="${this.escapeHtml(module.id)}">FOCUS</button></div><span class="pill">${Math.round(channel.gain * 100)}% · pan ${channel.pan.toFixed(2)}</span></article>`;
    }).join('');
    return `<div class="workspace-toolbar"><label>Master <input data-module-input="master-volume" type="range" min="0" max="1" step="0.01" value="${this.escapeHtml(this.mixerState.masterVolume)}"></label><span class="microcopy">${strips.length} channels · mute/solo/pan/level controls</span></div><div class="mixer-desk-grid">${rows}</div>`;
  }

  applyMixerChannel(moduleId) {
    const module = this.patchBay.modules.get(moduleId);
    const channel = this.mixerState.channels[moduleId];
    if (!module || !channel) return;
    if ('gainValue' in module) module.gainValue = channel.gain;
    if ('panValue' in module) module.panValue = channel.pan;
    if ('muted' in module) module.muted = channel.muted;
    if (module.output?.gain && this.runtime.context) module.output.gain.setTargetAtTime(channel.muted ? 0 : channel.gain, this.runtime.context.currentTime, 0.01);
    if (module.pan?.pan && this.runtime.context) module.pan.pan.setTargetAtTime(channel.pan, this.runtime.context.currentTime, 0.01);
    module.apply?.();
  }

  handleWorkspaceInput(event) {
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
      module.render?.();
      this.publishProjectChange('piano-note-velocity');
    }
  }

  handleModuleAction(action, target) {
    const moduleId = target.dataset.moduleId;
    const module = this.patchBay.modules.get(moduleId);
    if (!module) return;
    if (action === 'focus-module') {
      this.focusedModuleId = moduleId;
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
      const index = module.notes?.findIndex((note) => note.note === noteName && Math.round(note.beat / stepResolution) === Number(target.dataset.step));
      if (index >= 0) module.notes.splice(index, 1);
      else module.notes.push({ id: `note-${Date.now()}-${module.notes.length}`, kind: PortType.MIDI, type: 'note-on', beat, note: noteName, velocity: 0.8, duration: stepResolution * 2 });
      module.notes.sort((a, b) => a.beat - b.beat || a.note.localeCompare(b.note));
      module.render?.();
      this.renderWorkspaceView();
      this.publishProjectChange('piano-note-toggle');
      return;
    }
    if (action === 'add-note') {
      module.notes = module.notes || [];
      module.notes.push({ id: `note-${Date.now()}`, kind: PortType.MIDI, type: 'note-on', beat: 0, note: 'C4', velocity: 0.8, duration: module.stepResolutionBeats || 0.25 });
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
    }
  }

  moduleClipSummary(module) {
    const serialized = module.serialize?.() || {};
    const patterns = serialized.patterns || serialized.sequence || serialized.notes || serialized.steps || [];
    const count = Array.isArray(patterns) ? patterns.length : Object.keys(patterns || {}).length;
    return {
      id: module.id,
      title: module.title,
      kind: module.kind,
      count,
      hasTransport: module.inputs?.some((p) => p.type === PortType.CLOCK) || module.outputs?.some((p) => p.type === PortType.CLOCK),
    };
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
    if (view === 'session') {
      root.innerHTML = `<div class="workspace-grid"><article class="workspace-card"><strong>Shared session</strong><span class="big-number">${this.escapeHtml(code)}</span><p class="microcopy">Default mode auto-connects every visitor to this open Peernet/PeerJS-backed studio session.</p></article><article class="workspace-card"><strong>Participants</strong><span class="big-number">${activeSession?.participants?.length || 1}</span><p class="microcopy">Local pilot plus connected peers are listed in Session Info.</p></article><article class="workspace-card"><strong>Rig state</strong><span class="big-number">${modules.length}</span><p class="microcopy">${routeCount} packet routes · ${audioRoutes} audio routes · ${this.peernet.started ? 'peernet active' : 'local-first fallback'}</p></article></div>`;
      return;
    }
    if (view === 'clips') {
      this.ensureDefaultClipSlots();
      const rows = this.clipSlots.map((slot) => {
        const active = Boolean(slot.activeClipAt(this.currentBeat));
        const module = this.patchBay.modules.get(slot.moduleId);
        return `<div class="clip-slot-row ${active ? 'active' : ''}"><div><strong>${this.escapeHtml(slot.name || slot.clip?.name || slot.id)}</strong><span class="microcopy">${this.escapeHtml(module?.title || slot.moduleId)} · ${this.escapeHtml(slot.clip?.midi?.length || 0)} notes · q${this.escapeHtml(slot.quantizationBeats)}</span></div><span class="pill">${active ? 'playing' : slot.launchBeat == null ? 'empty' : 'queued'}</span><div class="button-row"><button type="button" data-clip-action="launch" data-slot-id="${this.escapeHtml(slot.id)}">LAUNCH</button><button type="button" data-clip-action="stop" data-slot-id="${this.escapeHtml(slot.id)}">STOP</button><button type="button" data-clip-action="place" data-slot-id="${this.escapeHtml(slot.id)}">PLACE</button><button type="button" data-clip-action="delete" data-slot-id="${this.escapeHtml(slot.id)}">DEL</button></div></div>`;
      }).join('');
      root.innerHTML = `<div class="workspace-toolbar"><button type="button" data-clip-action="create">CREATE CLIP</button><button type="button" data-clip-action="place-all">PLACE ALL</button><button type="button" data-clip-action="clear-arrangement">CLEAR ARRANGEMENT</button><span class="microcopy">beat ${this.escapeHtml(this.currentBeat)} · ${this.clipSlots.length} slots · backed by ClipSlot/Clip core</span></div><div class="workspace-list">${rows || '<p class="microcopy">No clip slots yet. Add a piano roll, OCRA grid, or sequencer, then create a clip.</p>'}</div>`;
      return;
    }
    if (view === 'arrangement') {
      const placements = this.arrangement.clips;
      const tracks = [...new Set(placements.map((placement) => placement.trackId))];
      const lanes = tracks.length ? tracks : this.clipCapableModules().slice(0, 4).map((module) => module.id);
      root.innerHTML = `<div class="workspace-toolbar"><button type="button" data-clip-action="place-all">PLACE ALL CLIPS</button><button type="button" data-clip-action="clear-arrangement">CLEAR</button><span class="microcopy">${placements.length} placements · loop ${this.arrangement.loopStartBeat}-${this.arrangement.loopEndBeat} beats</span></div>${lanes.map((trackId) => {
        const module = this.patchBay.modules.get(trackId);
        const trackClips = placements.filter((placement) => placement.trackId === trackId);
        return `<div class="timeline-lane"><strong>${this.escapeHtml(module?.title || trackId)}</strong><div class="timeline-track">${trackClips.map((placement) => `<span class="timeline-clip" style="left:${Math.min(92, placement.startBeat * 4)}%;width:${Math.max(10, placement.clip.lengthBeats * 4)}%">${this.escapeHtml(placement.clip.name)}</span>`).join('')}</div></div>`;
      }).join('')}<p class="microcopy">Arrangement is now real state from Arrangement.placeClip() and is exported with the project.</p>`;
      return;
    }
    if (view === 'mixer') {
      root.innerHTML = this.renderMixerEditor();
      return;
    }
    const focused = modules.find((module) => module.id === this.focusedModuleId) || modules.find((module) => module.id === document.querySelector('.module-card:hover')?.dataset.moduleId) || modules.find((module) => Array.isArray(module.notes)) || modules.find((module) => module.kind === 'midi-generator') || modules[0];
    if (!focused) {
      root.innerHTML = '<p class="microcopy">No module selected.</p>';
      return;
    }
    const detail = focused.kind === 'midi-generator'
      ? this.renderPianoRollEditor(focused)
      : `<div class="module-focus"><article class="workspace-card"><strong>${this.escapeHtml(focused.title)}</strong><p class="microcopy">${this.escapeHtml(focused.kind)} · ${focused.inputs?.length || 0} inputs · ${focused.outputs?.length || 0} outputs</p></article><article class="workspace-card"><strong>Patch summary</strong><p class="microcopy">Incoming: ${this.patchBay.routes.filter((r) => r.to.moduleId === focused.id).length} · Outgoing: ${this.patchBay.routes.filter((r) => r.from.moduleId === focused.id).length}</p></article></div>`;
    root.innerHTML = detail;
  }

  updateSessionUI() {
    const codeEl = document.querySelector('#sessionCode');
    const listEl = document.querySelector('#peerList');
    const activeSession = this.peernet.sessions?.getActiveSession?.();
    const code = activeSession?.code || this.sessionCode || this.defaultSessionCode;
    this.sessionCode = code;

    if (codeEl) codeEl.textContent = code;

    const participants = activeSession?.participants || [];
    const remotePeers = this.peerList.map((p) => ({
      id: p.id || p.peerId || p.name || 'peer',
      username: p.name || p.username || 'peer',
      role: 'peer',
    }));
    const rows = [...participants, ...remotePeers];
    if (listEl) {
      listEl.innerHTML = rows.length
        ? rows
            .map(
              (p) => `<div class="peer-item"><span class="peer-dot"></span>${this.escapeHtml(p.username || p.name || p.id || 'pilot')} <small>${this.escapeHtml(p.role || 'participant')}</small></div>`
            )
            .join('')
        : '<div class="peer-item dim">local pilot waiting for peers</div>';
    }
    this.renderWorkspaceView();
  }

  async bootstrapDefaultPeernetSession({ force = false } = {}) {
    if (this.peernet.started && !force) return this.peernet.sessions?.getActiveSession?.() || null;
    const username = this.urlParams.get('username') || document.querySelector('#pilotName')?.value || 'pilot';
    const pilotEl = document.querySelector('#pilotName');
    if (pilotEl) pilotEl.value = username;
    this.subLobby.setUsername(username);
    this.peernet.start({
      username,
      targetPeerId: this.targetPeerId,
      spectate: this.spectateMode,
      sessionCode: this.defaultSessionCode,
    });
    const session = this.peernet.ensureSharedSession({
      id: 'v11-peer-daw:open-studio',
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
      '<div class="module-actions"><button class="remove" title="remove module">Remove</button><button class="focus" title="focus module">Focus</button></div><div class="mount"></div>';
    this.modulesEl.appendChild(card);
    module.mount(card.querySelector('.mount'));
    module.addEventListener?.('sample-library-sync', (event) => this.syncModuleMetadataToSampleLibrary(event.detail));
    card.querySelector('.remove').addEventListener('click', () => this.removeModule(module.id));
    card.querySelector('.focus').addEventListener('click', () => {
      this.focusedModuleId = module.id;
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
    document.querySelector(`[data-module-id="${moduleId}"]`)?.remove();
    document.querySelector(`[data-strip-id="${moduleId}"]`)?.remove();
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
    this.renderWorkspaceView();
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
    this.renderWorkspaceView();
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
      clips: this.serializeClipState(),
      arrangement: this.arrangement.serialize(),
      mixer: this.serializeMixerState(),
      mixer: this.serializeMixerState(),
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
      clips: this.serializeClipState(),
      arrangement: this.arrangement.serialize(),
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
    for (const route of this.patchBay.routes) {
      this.routingGraph.connect(route.from.moduleId, route.to.moduleId, route.from.outputId);
    }
    this.renderRoutes();
    this.renderPatchCanvas();
    this.ensureDefaultClipSlots();
    this.updateStats();
    this.renderWorkspaceView();
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
