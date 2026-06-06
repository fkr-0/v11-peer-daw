// PeerModGroove/src/modules/field-recorder.js

import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';

export class FieldRecorderModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('field'),
      title: config.title || 'Field Recorder',
      kind: 'audio-source',
      inputs: [{ id: 'control', type: PortType.CONTROL }],
      outputs: [
        { id: 'audio', type: PortType.AUDIO },
        { id: 'control', type: PortType.CONTROL },
      ],
    });
    this.output = null;
    this.buffer = null;
    this.fileName = config.fileName || 'no sample loaded';
    this.takes = Array.isArray(config.takes) ? config.takes.map((take) => ({ ...take })) : [];
    this.waveformEdit = config.waveformEdit ? { ...config.waveformEdit } : null;
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.6;
    }
  }

  async loadFile(file) {
    const data = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(data);
    this.fileName = file.name;
    this.render();
  }

  play() {
    if (!this.ctx || !this.output || !this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.output);
    src.start();
  }

  serialize() {
    return {
      ...super.serialize(),
      fileName: this.fileName,
      takes: this.takes.map((take) => ({ ...take })),
      waveformEdit: this.waveformEdit ? { ...this.waveformEdit } : undefined,
    };
  }

  hydrate(data = {}) {
    this.fileName = data.fileName || this.fileName;
    this.takes = Array.isArray(data.takes) ? data.takes.map((take) => ({ ...take })) : this.takes;
    this.waveformEdit = data.waveformEdit ? { ...data.waveformEdit } : this.waveformEdit;
    this.render();
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
      <div class="module-head"><span>◉</span><strong>${escapeHtml(this.title)}</strong><small>CONTROL IN / AUDIO OUT</small></div>
      <input type="file" accept="audio/*" class="file-input">
      <button class="mini-button">PLAY SAMPLE</button>
      <p class="microcopy">${escapeHtml(this.fileName)}</p>
    `;
    this.root
      .querySelector('input')
      .addEventListener('change', (e) => e.target.files[0] && this.loadFile(e.target.files[0]));
    this.root.querySelector('button').addEventListener('click', () => this.play());
  }
}
