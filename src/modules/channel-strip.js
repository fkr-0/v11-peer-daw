// PeerModGroove/src/modules/channel-strip.js
import { ModuleBase, PortType, uid } from '../core/contracts.js';

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
    this.gainValue = config.gain ?? 0.8;
    this.panValue = config.pan ?? 0;
    this.muted = false;
  }
  async start(context) {
    this.ctx = context;
    if (!this.input) {
      this.input = this.ctx.createGain();
      this.pan = this.ctx.createStereoPanner?.() || this.ctx.createGain();
      this.output = this.ctx.createGain();
      this.input.connect(this.pan);
      this.pan.connect(this.output);
      this.apply();
    }
  }
  apply() {
    if (!this.ctx) return;
    this.output.gain.setTargetAtTime(this.muted ? 0 : this.gainValue, this.ctx.currentTime, 0.01);
    if (this.pan.pan) this.pan.pan.setTargetAtTime(this.panValue, this.ctx.currentTime, 0.01);
  }
  receive(packet) {
    if (packet.kind !== PortType.CONTROL) return;
    if (packet.target === 'gain') this.gainValue = Number(packet.value);
    if (packet.target === 'pan') this.panValue = Number(packet.value);
    if (packet.target === 'mute') this.muted = Boolean(packet.value);
    this.apply();
    this.render();
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
    this.root.innerHTML = `<div class="module-head"><span>▥</span><strong>${this.title}</strong><small>CHANNEL STRIP</small></div><label>Gain <input class="mini-input" type="range" min="0" max="1.5" step="0.01" value="${this.gainValue}" data-gain></label><label>Pan <input class="mini-input" type="range" min="-1" max="1" step="0.01" value="${this.panValue}" data-pan></label><button class="mini-button" data-mute>${this.muted ? 'UNMUTE' : 'MUTE'}</button>`;
    this.root.querySelector('[data-gain]').oninput = (e) => {
      this.gainValue = Number(e.target.value);
      this.apply();
    };
    this.root.querySelector('[data-pan]').oninput = (e) => {
      this.panValue = Number(e.target.value);
      this.apply();
    };
    this.root.querySelector('[data-mute]').onclick = () => {
      this.muted = !this.muted;
      this.apply();
      this.render();
    };
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
    this.root.innerHTML = `<div class="module-head"><span>▧</span><strong>${this.title}</strong><small>MASTER MIX</small></div><label>Master <input class="mini-input" type="range" min="0" max="1.5" step="0.01" value="${this.master}" data-master></label>`;
    this.root.querySelector('[data-master]').oninput = (e) => {
      this.master = Number(e.target.value);
      if (this.output && this.ctx)
        this.output.gain.setTargetAtTime(this.master, this.ctx.currentTime, 0.01);
    };
  }
}
