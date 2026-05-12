// V11 Peer DAW/src/app.js
// Main application module

import { AudioRuntime } from './core/audio.js';
import { PortType } from './core/contracts.js';
import { PatchBay } from './core/patchbay.js';
import { PeernetStack } from './core/peernet-stack.js';
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
    this.sessionCode = null;
    this.peerList = [];
  }

  async init() {
    this.createStarfield();
    this.bindChrome();
    this.patchBay.addEventListener('packet', (e) => this.logPacket(e.detail));
    this.patchBay.addEventListener('route:add', () => this.renderRoutes());
    this.bindPatchCanvas();
    this.bindPeernetStack();
    await this.bootstrapDefaultRig();
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

    document.querySelector('#btnConnectPeer').addEventListener('click', () => {
      const username = document.querySelector('#pilotName').value || 'pilot';
      this.peernet.start({ username });
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
      this.renderRoutes();
      this.renderPatchCanvas();
      this.logText('All routes cleared');
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

  async bootstrapDefaultRig() {
    const rig = createDefaultPeerDawRig(this.runtime);
    this.mixer = rig.master;
    this.clock = rig.clock;
    const { ocra, synth, sampler, field, peer } = rig;

    for (const module of [this.mixer, this.clock, ocra, synth, sampler, field, peer]) {
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
      { moduleId: synth.id, outputId: 'midi' },
      { moduleId: peer.id, inputId: 'midi' }
    );

    this.renderRoutes();
  }

  bindPeernetStack() {
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
      this.patchCanvas = new PatchCanvas(this.patchCanvasEl, this.patchBay, this.routingGraph);
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
    card.querySelector('.remove').addEventListener('click', () => this.removeModule(module.id));

    if (this.runtime.context) await module.start(this.runtime.context);
    if (
      autoConnectAudio &&
      module.outputs.some((p) => p.type === PortType.AUDIO) &&
      module !== this.mixer
    ) {
      if (this.runtime.context) module.connectAudio(this.runtime.destination);
      this.routingGraph.connect(module.id, 'destination', 'audio');
      this.syncAudioGraph();
      this.addMixerStrip(module);
    }

    this.updateStats();
  }

  async startAudioModules() {
    for (const module of this.patchBay.modules.values()) {
      await module.start?.(this.runtime.context);
      if (module.outputs?.some((p) => p.type === PortType.AUDIO) && module !== this.mixer) {
        module.disconnectAudio?.();
        module.connectAudio(this.runtime.destination);
      }
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
    this.routesEl.innerHTML =
      this.patchBay.routes
        .map(
          (route) => `
      <li><code>${route.from.moduleId}:${route.from.outputId}</code> → <code>${route.to.moduleId}:${route.to.inputId}</code></li>
    `
        )
        .join('') || '<li class="dim">no routes yet</li>';
    this.updateStats();
  }

  renderPatchCanvas() {
    if (this.patchCanvas) {
      this.patchCanvas.render();
    }
  }

  updateStats() {
    document.querySelector('#moduleCount').textContent = `${this.patchBay.modules.size} modules`;
    document.querySelector('#routeCount').textContent = `${this.patchBay.routes.length} routes`;
  }

  logPacket({ from, outputId, packet }) {
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
    if (this.graphSync) {
      this.graphSync.sync(this.patchBay, this.routingGraph);
    }
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

  applyRig(payload) {
    this.logText(`restore requested: ${payload?.modules?.length || 0} modules`);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.v11PeerDAW = new V11PeerDAW();
  window.v11PeerDAW.init();
});
