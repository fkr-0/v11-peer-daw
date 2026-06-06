// PeerModGroove/src/modules/channel-strip.js
import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';

const FILTER_TYPES = new Set([
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizeFilter(filter = {}, index = 0) {
  const type = FILTER_TYPES.has(filter.type) ? filter.type : 'peaking';
  return {
    id: String(filter.id || `filter-${index + 1}`),
    type,
    frequency: clamp(filter.frequency ?? 1000, 20, 20000),
    q: clamp(filter.q ?? filter.Q ?? 1, 0.1, 30),
    gain: clamp(filter.gain ?? 0, -24, 24),
    enabled: filter.enabled !== false,
  };
}

export class ChannelStripModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('channel'),
      title: config.title || 'Channel Strip',
      kind: 'mixer-channel',
      inputs: [
        { id: 'audio', type: PortType.AUDIO },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.gainValue = clamp(config.gain ?? 0.8, 0, 1.5);
    this.panValue = clamp(config.pan ?? 0, -1, 1);
    this.muted = Boolean(config.muted ?? false);
    this.filters = (config.filters || []).map((filter, index) => normalizeFilter(filter, index));
    this.filterNodes = [];
  }

  async start(context) {
    this.ctx = context;
    if (!this.input) {
      this.input = this.ctx.createGain();
      this.pan = this.ctx.createStereoPanner?.() || this.ctx.createGain();
      this.output = this.ctx.createGain();
      this.rebuildFilterChain();
      this.apply();
    }
  }

  rebuildFilterChain() {
    if (!this.ctx || !this.input || !this.pan) return;
    this.input.disconnect?.();
    for (const node of this.filterNodes) node.disconnect?.();
    this.filterNodes = this.filters
      .filter((filter) => filter.enabled)
      .map((filter) => this.createFilterNode(filter));

    const chain = [this.input, ...this.filterNodes, this.pan, this.output];
    for (let index = 0; index < chain.length - 1; index += 1) {
      chain[index].connect(chain[index + 1]);
    }
  }

  createFilterNode(filter) {
    const node = this.ctx.createBiquadFilter();
    node.type = filter.type;
    node.frequency.value = filter.frequency;
    node.Q.value = filter.q;
    node.gain.value = filter.gain;
    return node;
  }

  apply() {
    if (!this.ctx || !this.output) return;
    this.output.gain.setTargetAtTime(this.muted ? 0 : this.gainValue, this.ctx.currentTime, 0.01);
    if (this.pan.pan) this.pan.pan.setTargetAtTime(this.panValue, this.ctx.currentTime, 0.01);
    this.applyFilters();
  }

  applyFilters() {
    if (!this.ctx) return;
    const enabledFilters = this.filters.filter((filter) => filter.enabled);
    enabledFilters.forEach((filter, index) => {
      const node = this.filterNodes[index];
      if (!node) return;
      node.type = filter.type;
      node.frequency.setTargetAtTime(filter.frequency, this.ctx.currentTime, 0.01);
      node.Q.setTargetAtTime(filter.q, this.ctx.currentTime, 0.01);
      node.gain.setTargetAtTime(filter.gain, this.ctx.currentTime, 0.01);
    });
  }

  receive(packet) {
    if (packet.kind !== PortType.CONTROL) return;
    if (packet.type === 'preset') {
      this.importPreset(packet.value);
      return;
    }
    if (packet.target === 'gain') this.gainValue = clamp(packet.value, 0, 1.5);
    if (packet.target === 'pan') this.panValue = clamp(packet.value, -1, 1);
    if (packet.target === 'mute') this.muted = Boolean(packet.value);
    if (packet.target?.startsWith('filter.')) {
      this.setFilterParam(packet.filterId, packet.target.slice('filter.'.length), packet.value);
    }
    this.apply();
    this.render();
  }

  setFilterParam(filterId, key, value) {
    const filter = this.filters.find((candidate) => candidate.id === filterId);
    if (!filter) return;
    if (key === 'type') filter.type = FILTER_TYPES.has(value) ? value : filter.type;
    if (key === 'frequency') filter.frequency = clamp(value, 20, 20000);
    if (key === 'q' || key === 'Q') filter.q = clamp(value, 0.1, 30);
    if (key === 'gain') filter.gain = clamp(value, -24, 24);
    if (key === 'enabled') {
      filter.enabled = Boolean(value);
      this.rebuildFilterChain();
    }
  }

  addFilter(filter = {}) {
    this.filters.push(normalizeFilter(filter, this.filters.length));
    this.rebuildFilterChain();
    this.apply();
    this.render();
  }

  removeFilter(filterId) {
    this.filters = this.filters.filter((filter) => filter.id !== filterId);
    this.rebuildFilterChain();
    this.apply();
    this.render();
  }

  exportPreset() {
    return {
      schemaVersion: 1,
      type: 'v11.channel-strip',
      title: this.title,
      channel: {
        gain: this.gainValue,
        pan: this.panValue,
        muted: this.muted,
      },
      filters: this.filters.map((filter) => ({ ...filter })),
    };
  }

  exportPresetJson() {
    return JSON.stringify(this.exportPreset(), null, 2);
  }

  importPresetJson(json) {
    return this.importPreset(JSON.parse(json));
  }

  importPreset(preset = {}) {
    if (preset.type && preset.type !== 'v11.channel-strip') {
      throw new Error(`Unsupported channel strip preset type: ${preset.type}`);
    }
    this.title = preset.title || this.title;
    this.gainValue = clamp(preset.channel?.gain ?? this.gainValue, 0, 1.5);
    this.panValue = clamp(preset.channel?.pan ?? this.panValue, -1, 1);
    this.muted = Boolean(preset.channel?.muted ?? this.muted);
    this.filters = (preset.filters || []).map((filter, index) => normalizeFilter(filter, index));
    this.rebuildFilterChain();
    this.apply();
    this.render();
    return this.exportPreset();
  }

  serialize() {
    return {
      ...super.serialize(),
      ...this.exportPreset(),
    };
  }

  hydrate(data = {}) {
    this.importPreset(data);
  }

  connectAudio(dest) {
    if (this.output && dest) this.output.connect(dest);
  }

  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }

  renderFilterRows() {
    if (!this.filters.length) return '<p class="microcopy">No filters in this channel strip.</p>';
    return this.filters
      .map(
        (filter) =>
          `<div class="zone-row" data-filter="${filter.id}"><strong>${filter.type}</strong><small>${filter.id}</small><label>Hz <input class="mini-input" data-filter-param="frequency" type="number" min="20" max="20000" value="${filter.frequency}"></label><label>Q <input class="mini-input" data-filter-param="q" type="number" min="0.1" max="30" step="0.1" value="${filter.q}"></label><label>Gain <input class="mini-input" data-filter-param="gain" type="number" min="-24" max="24" step="0.1" value="${filter.gain}"></label><button class="mini-button" data-filter-toggle>${filter.enabled ? 'BYPASS' : 'ENABLE'}</button><button class="mini-button" data-filter-remove>REMOVE</button></div>`
      )
      .join('');
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `<div class="module-head"><span>▥</span><strong>${escapeHtml(this.title)}</strong><small>CHANNEL STRIP</small></div><label>Gain <input class="mini-input" type="range" min="0" max="1.5" step="0.01" value="${this.gainValue}" data-gain></label><label>Pan <input class="mini-input" type="range" min="-1" max="1" step="0.01" value="${this.panValue}" data-pan></label><button class="mini-button" data-mute>${this.muted ? 'UNMUTE' : 'MUTE'}</button><div class="effect-rack"><button class="mini-button" data-add-filter>ADD FILTER</button><button class="mini-button" data-export-preset>EXPORT PRESET</button><textarea class="mini-input" data-preset-json rows="4" placeholder="paste channel strip preset JSON"></textarea><button class="mini-button" data-import-preset>IMPORT PRESET</button>${this.renderFilterRows()}</div>`;
    this.root.querySelector('[data-gain]').oninput = (e) => {
      this.gainValue = clamp(e.target.value, 0, 1.5);
      this.apply();
    };
    this.root.querySelector('[data-pan]').oninput = (e) => {
      this.panValue = clamp(e.target.value, -1, 1);
      this.apply();
    };
    this.root.querySelector('[data-mute]').onclick = () => {
      this.muted = !this.muted;
      this.apply();
      this.render();
    };
    this.root.querySelector('[data-add-filter]').onclick = () => this.addFilter();
    this.root.querySelector('[data-export-preset]').onclick = () => {
      this.root.querySelector('[data-preset-json]').value = this.exportPresetJson();
    };
    this.root.querySelector('[data-import-preset]').onclick = () => {
      this.importPresetJson(this.root.querySelector('[data-preset-json]').value);
    };
    this.root.querySelectorAll('[data-filter]').forEach((row) => {
      const filterId = row.dataset.filter;
      row.querySelectorAll('[data-filter-param]').forEach((input) => {
        input.oninput = (e) => {
          this.setFilterParam(filterId, e.target.dataset.filterParam, e.target.value);
          this.apply();
        };
      });
      row.querySelector('[data-filter-toggle]').onclick = () => {
        const filter = this.filters.find((candidate) => candidate.id === filterId);
        this.setFilterParam(filterId, 'enabled', !filter.enabled);
        this.render();
      };
      row.querySelector('[data-filter-remove]').onclick = () => this.removeFilter(filterId);
    });
  }
}

export class MixerDeskModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('mixerdesk'),
      title: config.title || 'Mixer Desk',
      kind: 'mixer',
      inputs: [
        { id: 'audio', type: PortType.AUDIO },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.master = config.master ?? 0.85;
  }
  async start(context) {
    this.ctx = context;
    if (!this.input) {
      this.input = this.ctx.createGain();
      this.output = this.ctx.createGain();
      this.input.connect(this.output);
      this.output.gain.value = this.master;
    }
  }
  receive(packet) {
    if (packet.kind === PortType.CONTROL && packet.target === 'master') {
      this.master = Number(packet.value);
      if (this.output) this.output.gain.setTargetAtTime(this.master, this.ctx.currentTime, 0.01);
    }
  }
  connectAudio(dest) {
    if (this.output && dest) this.output.connect(dest);
  }
  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }
  render() {
    if (!this.root) return;
    this.root.innerHTML = `<div class="module-head"><span>▧</span><strong>${escapeHtml(this.title)}</strong><small>MASTER MIX</small></div><label>Master <input class="mini-input" type="range" min="0" max="1.5" step="0.01" value="${this.master}" data-master></label>`;
    this.root.querySelector('[data-master]').oninput = (e) => {
      this.master = Number(e.target.value);
      if (this.output && this.ctx)
        this.output.gain.setTargetAtTime(this.master, this.ctx.currentTime, 0.01);
    };
  }
}
