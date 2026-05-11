// PeerModGroove/src/modules/clean-sampler.js

import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { packetAudioTime } from '../core/scheduler.js';

export class CleanSamplerModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('sampler'),
      title: config.title || 'Clean Sampler',
      kind: 'audio-source',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.output = null;
    this.buffer = null;
    this.fileName = 'drop or choose an audio sample';
    this.pitchMap = new Map();
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.66;
    }
  }

  async loadFile(file) {
    if (!this.ctx) return;
    const data = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(data);
    this.fileName = file.name;
    this.render();
  }

  receive(packet) {
    if (packet.kind === PortType.MIDI && packet.type === 'note-on')
      this.play(packet.note, packet.velocity ?? 0.8, packetAudioTime(this.ctx, packet));
    if (packet.kind === PortType.CONTROL && packet.type === 'trigger')
      this.play(packet.note || 'C4', packet.velocity ?? 0.8, packetAudioTime(this.ctx, packet));
  }

  play(note = 'C4', velocity = 0.8, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output || !this.buffer) return;
    const src = this.ctx.createBufferSource();
    const amp = this.ctx.createGain();
    src.buffer = this.buffer;
    src.playbackRate.value = this.pitchRatio(note);
    amp.gain.value = velocity;
    src.connect(amp);
    amp.connect(this.output);
    src.start(when);
  }

  pitchRatio(note) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const m = String(note).match(/^([A-G]#?)(-?\d+)$/);
    if (!m) return 1;
    const midi = (Number(m[2]) + 1) * 12 + names.indexOf(m[1]);
    return 2 ** ((midi - 60) / 12);
  }

  connectAudio(destination) {
    if (this.output && destination) this.output.connect(destination);
  }
  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>◈</span><strong>${this.title}</strong><small>MIDI/TRIGGER IN / AUDIO OUT</small></div>
      <div class="drop-zone" tabindex="0">${this.fileName}</div>
      <input type="file" accept="audio/*" class="file-input">
      <button class="mini-button" data-play>PLAY C4</button>
      <p class="microcopy">Clean one-shot sampler. MIDI note changes playback rate around C4.</p>
    `;
    const input = this.root.querySelector('input');
    const drop = this.root.querySelector('.drop-zone');
    input.addEventListener('change', (e) => e.target.files[0] && this.loadFile(e.target.files[0]));
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('hot');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('hot');
      const file = e.dataTransfer.files[0];
      if (file) this.loadFile(file);
    });
    this.root.querySelector('[data-play]').addEventListener('click', () => this.play('C4', 0.9));
  }
}
