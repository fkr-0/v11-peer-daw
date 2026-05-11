// PeerModGroove/src/modules/multisampler.js
import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { packetAudioTime } from '../core/scheduler.js';

export class MultiSamplerModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('multisampler'),
      title: config.title || 'Slicing MultiSampler',
      kind: 'audio-source',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.output = null;
    this.samples = new Map();
    this.zones = [];
    this.sliceCount = config.sliceCount || 8;
    this.fileName = 'drop audio for slicing / multisample';
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.72;
    }
  }

  async loadFile(file, rootNote = 'C4', minNote = 'C1', maxNote = 'C7') {
    if (!this.ctx) return;
    const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    this.samples.set(rootNote, buffer);
    this.zones.push({
      rootNote,
      min: this.midi(minNote),
      max: this.midi(maxNote),
      buffer,
      name: file.name,
    });
    this.fileName = file.name;
    this.render();
  }

  receive(packet) {
    if (packet.kind === PortType.MIDI && packet.type === 'note-on')
      this.play(
        packet.note,
        packet.velocity ?? 0.8,
        packetAudioTime(this.ctx, packet),
        packet.slice
      );
  }

  play(note = 'C4', velocity = 0.8, when = this.ctx?.currentTime || 0, slice = null) {
    if (!this.ctx || !this.output || (!this.samples.size && !this.zones.length)) return;
    const zone = this.pickZone(note);
    const root = zone?.rootNote || [...this.samples.keys()][0];
    const buffer = zone?.buffer || [...this.samples.values()][0];
    const src = this.ctx.createBufferSource();
    const amp = this.ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = this.pitchRatio(note, root);
    amp.gain.setValueAtTime(Math.max(0.001, velocity), when);
    src.connect(amp);
    amp.connect(this.output);
    if (slice !== null) {
      const dur = buffer.duration / this.sliceCount;
      src.start(when, Math.max(0, Number(slice) % this.sliceCount) * dur, dur * 0.98);
    } else src.start(when);
  }

  pickZone(note) {
    const m = this.midi(note);
    return this.zones.find((z) => m >= z.min && m <= z.max) || this.zones[0];
  }

  pitchRatio(note, root = 'C4') {
    const n = this.midi(note);
    const r = this.midi(root);
    return 2 ** ((n - r) / 12);
  }

  midi(note) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const m = String(note).match(/^([A-G]#?)(-?\d+)$/);
    return m ? (Number(m[2]) + 1) * 12 + names.indexOf(m[1]) : 60;
  }

  noteName(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  connectAudio(dest) {
    if (this.output && dest) this.output.connect(dest);
  }
  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }

  renderWaveform(zone) {
    if (!zone?.buffer) return '';
    const data = zone.buffer.getChannelData(0);
    const bars = 48;
    const step = Math.max(1, Math.floor(data.length / bars));
    return Array.from({ length: bars }, (_, i) => {
      let peak = 0;
      for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(data[i * step + j] || 0));
      const h = Math.max(4, Math.round(peak * 48));
      return `<i style="height:${h}px"></i>`;
    }).join('');
  }

  render() {
    if (!this.root) return;
    const zoneRows =
      this.zones
        .map(
          (z, i) =>
            `<div class="zone-row" data-zone="${i}"><strong>${z.name}</strong><small>${this.noteName(z.min)}–${this.noteName(z.max)} root ${z.rootNote}</small><div class="waveform">${this.renderWaveform(z)}</div><label>min <input class="mini-input" data-min type="text" value="${this.noteName(z.min)}"></label><label>max <input class="mini-input" data-max type="text" value="${this.noteName(z.max)}"></label><label>root <input class="mini-input" data-root type="text" value="${z.rootNote}"></label></div>`
        )
        .join('') || '<p class="microcopy">No samples loaded yet.</p>';
    this.root.innerHTML = `<div class="module-head"><span>▣</span><strong>${this.title}</strong><small>MIDI IN / SLICED AUDIO OUT</small></div><div class="drop-zone">${this.fileName}</div><input type="file" accept="audio/*" class="file-input" multiple><label>Slices <input class="mini-input" type="number" min="1" max="32" value="${this.sliceCount}" data-slices></label><div class="sampler-zones">${zoneRows}</div><p class="microcopy">Multiple files create multisample zones. packet.slice triggers slice playback.</p>`;
    this.root
      .querySelector('input[type=file]')
      .addEventListener('change', (e) =>
        [...e.target.files].forEach((file, i) =>
          this.loadFile(file, 'C4', i ? 'C4' : 'C1', i ? 'C7' : 'B3')
        )
      );
    this.root
      .querySelector('[data-slices]')
      .addEventListener('input', (e) => (this.sliceCount = Number(e.target.value) || 8));
    this.root.querySelectorAll('[data-zone]').forEach((row) => {
      const z = this.zones[Number(row.dataset.zone)];
      row.querySelector('[data-min]').onchange = (e) => (z.min = this.midi(e.target.value));
      row.querySelector('[data-max]').onchange = (e) => (z.max = this.midi(e.target.value));
      row.querySelector('[data-root]').onchange = (e) =>
        (z.rootNote = e.target.value || z.rootNote);
    });
  }
}
