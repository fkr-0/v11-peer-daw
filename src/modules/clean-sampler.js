// PeerModGroove/src/modules/clean-sampler.js

import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { packetAudioTime } from '../core/scheduler.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

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
    this.fileName = config.fileName || 'drop or choose an audio sample';
    this.pitchMap = new Map();
    this.rootNote = config.rootNote || 'C4';
    this.timeShift = config.timeShift ?? 0;
    this.stretchRatio = config.stretchRatio ?? 1;
    this.pitchSemitones = config.pitchSemitones ?? 0;
    this.pitchCents = config.pitchCents ?? 0;
    this.attack = config.attack ?? 0.005;
    this.decay = config.decay ?? 0.04;
    this.sustain = config.sustain ?? 0.85;
    this.release = config.release ?? 0.08;
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
      this.play(
        packet.note || this.rootNote,
        packet.velocity ?? 0.8,
        packetAudioTime(this.ctx, packet)
      );
    if (packet.kind === PortType.CONTROL && packet.type === 'param') {
      this.setParam(packet.target, packet.value);
    }
  }

  play(note = this.rootNote, velocity = 0.8, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output || !this.buffer) return;
    const src = this.ctx.createBufferSource();
    const amp = this.ctx.createGain();
    const offset = Math.min(Math.max(0, this.timeShift), this.buffer.duration);
    const sourceDuration = Math.max(0, this.buffer.duration - offset);
    const playedDuration = sourceDuration * this.stretchRatio;

    src.buffer = this.buffer;
    src.playbackRate.value = this.playbackRateFor(note);
    this.applyAdsr(amp.gain, velocity, when, playedDuration);
    src.connect(amp);
    amp.connect(this.output);
    src.start(when, offset, sourceDuration);
    src.stop?.(when + playedDuration + this.release + 0.05);
  }

  applyAdsr(gain, velocity, when, duration) {
    const attackEnd = when + this.attack;
    const decayEnd = attackEnd + this.decay;
    const releaseStart = when + Math.max(this.attack + this.decay, duration);
    gain.setValueAtTime(0.0001, when);
    gain.linearRampToValueAtTime(Math.max(0.001, velocity), attackEnd);
    gain.linearRampToValueAtTime(Math.max(0.001, velocity * this.sustain), decayEnd);
    gain.setTargetAtTime(0.0001, releaseStart, this.release);
  }

  playbackRateFor(note) {
    return (
      (this.pitchRatio(note) * 2 ** ((this.pitchSemitones + this.pitchCents / 100) / 12)) /
      this.stretchRatio
    );
  }

  pitchRatio(note) {
    return 2 ** ((this.midi(note) - this.midi(this.rootNote)) / 12);
  }

  midi(note) {
    const m = String(note).match(/^([A-G]#?)(-?\d+)$/);
    if (!m) return 60;
    return (Number(m[2]) + 1) * 12 + NOTE_NAMES.indexOf(m[1]);
  }

  setParam(target, value) {
    const setters = {
      rootNote: () => {
        this.rootNote = String(value || this.rootNote);
      },
      timeShift: () => {
        this.timeShift = clamp(value, 0, 3600);
      },
      stretchRatio: () => {
        this.stretchRatio = clamp(value, 0.25, 4);
      },
      pitchSemitones: () => {
        this.pitchSemitones = clamp(value, -48, 48);
      },
      pitchCents: () => {
        this.pitchCents = clamp(value, -100, 100);
      },
      attack: () => {
        this.attack = clamp(value, 0, 10);
      },
      decay: () => {
        this.decay = clamp(value, 0, 10);
      },
      sustain: () => {
        this.sustain = clamp(value, 0, 1);
      },
      release: () => {
        this.release = clamp(value, 0.001, 10);
      },
    };
    setters[target]?.();
    this.render();
  }

  serialize() {
    return {
      ...super.serialize(),
      fileName: this.fileName,
      params: {
        attack: this.attack,
        decay: this.decay,
        pitchCents: this.pitchCents,
        pitchSemitones: this.pitchSemitones,
        release: this.release,
        rootNote: this.rootNote,
        stretchRatio: this.stretchRatio,
        sustain: this.sustain,
        timeShift: this.timeShift,
      },
    };
  }

  hydrate(data = {}) {
    this.fileName = data.fileName || this.fileName;
    for (const [key, value] of Object.entries(data.params || {})) this.setParam(key, value);
  }

  extractWaveformPeaks(bars = 48) {
    if (!this.buffer) return [];
    const data = this.buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(data.length / bars));
    return Array.from({ length: bars }, (_, index) => {
      let peak = 0;
      const start = index * step;
      const end = Math.min(data.length, start + step);
      for (let cursor = start; cursor < end; cursor += 1) {
        peak = Math.max(peak, Math.abs(data[cursor] || 0));
      }
      return Number(Math.min(1, peak).toFixed(3));
    });
  }

  renderWaveform(bars = 48) {
    if (!this.buffer) return '<p class="microcopy">Load a sample to see its waveform.</p>';
    const barsHtml = this.extractWaveformPeaks(bars)
      .map((peak) => `<i style="height:${Math.max(4, Math.round(peak * 48))}px"></i>`)
      .join('');
    return `<div class="waveform sampler-waveform" role="img" aria-label="Waveform preview for ${this.fileName}">${barsHtml}</div>`;
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
      ${this.renderWaveform()}
      <div class="effect-rack sampler-controls">
        <label>Root <input class="mini-input" data-param="rootNote" type="text" value="${this.rootNote}"></label>
        <label>Shift <input class="mini-input" data-param="timeShift" type="number" min="0" step="0.01" value="${this.timeShift}"></label>
        <label>Stretch <input class="mini-input" data-param="stretchRatio" type="range" min="0.25" max="4" step="0.01" value="${this.stretchRatio}"></label>
        <label>Pitch <input class="mini-input" data-param="pitchSemitones" type="range" min="-48" max="48" step="1" value="${this.pitchSemitones}"></label>
        <label>Cents <input class="mini-input" data-param="pitchCents" type="range" min="-100" max="100" step="1" value="${this.pitchCents}"></label>
        <label>A <input class="mini-input" data-param="attack" type="range" min="0" max="2" step="0.001" value="${this.attack}"></label>
        <label>D <input class="mini-input" data-param="decay" type="range" min="0" max="2" step="0.001" value="${this.decay}"></label>
        <label>S <input class="mini-input" data-param="sustain" type="range" min="0" max="1" step="0.01" value="${this.sustain}"></label>
        <label>R <input class="mini-input" data-param="release" type="range" min="0.001" max="4" step="0.001" value="${this.release}"></label>
      </div>
      <button class="mini-button" data-play>PLAY ${this.rootNote}</button>
      <p class="microcopy">One-shot sampler with waveform preview, time-shift, stretch/repitch, pitch offset, and ADSR.</p>
    `;
    const input = this.root.querySelector('input[type=file]');
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
    this.root.querySelectorAll('[data-param]').forEach((el) => {
      el.addEventListener('input', (e) => this.setParam(e.target.dataset.param, e.target.value));
      el.addEventListener('change', (e) => this.setParam(e.target.dataset.param, e.target.value));
    });
    this.root
      .querySelector('[data-play]')
      .addEventListener('click', () => this.play(this.rootNote, 0.9));
  }
}
