// V11 Peer DAW/src/modules/synths.js
// Extensible synth modules for the consolidated peer DAW.

import { ModuleBase, PortType, midiNoteToFrequency, uid } from '../core/contracts.js';
import { packetAudioTime } from '../core/scheduler.js';

export class PolySynthModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('polysynth'),
      title: config.title || 'Poly Synth',
      kind: 'audio-generator',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.output = null;
    this.filter = null;
    this.voices = new Map();
    this.waveform = config.waveform || 'sawtooth';
    this.detuneCents = config.detuneCents ?? 7;
    this.cutoff = config.cutoff || 2400;
    this.release = config.release || 0.18;
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = this.cutoff;
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.36;
      this.filter.connect(this.output);
    }
  }

  receive(packet) {
    if (packet.kind === PortType.MIDI) {
      if (packet.type === 'note-on')
        this.noteOn(packet.note, packet.velocity ?? 0.75, packetAudioTime(this.ctx, packet));
      if (packet.type === 'note-off') this.noteOff(packet.note, packetAudioTime(this.ctx, packet));
    }

    if (packet.kind === PortType.CONTROL && packet.type === 'param') {
      this.setParam(packet.target, packet.value);
    }
  }

  setParam(target, value) {
    if (target === 'cutoff') {
      this.cutoff = Number(value) || this.cutoff;
      if (this.filter && this.ctx)
        this.filter.frequency.setTargetAtTime(this.cutoff, this.ctx.currentTime, 0.02);
    }
    if (target === 'waveform' && ['sine', 'triangle', 'sawtooth', 'square'].includes(value)) {
      this.waveform = value;
    }
  }

  noteOn(note, velocity = 0.75, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.filter) return;
    this.noteOff(note, when);

    const frequency = midiNoteToFrequency(note);
    const amp = this.ctx.createGain();
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();

    oscA.type = this.waveform;
    oscB.type = this.waveform;
    oscA.frequency.value = frequency;
    oscB.frequency.value = frequency;
    oscA.detune.value = -this.detuneCents;
    oscB.detune.value = this.detuneCents;

    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity), when + 0.012);
    amp.gain.setTargetAtTime(velocity * 0.68, when + 0.04, 0.08);

    oscA.connect(amp);
    oscB.connect(amp);
    amp.connect(this.filter);
    oscA.start(when);
    oscB.start(when);
    this.voices.set(note, { oscillators: [oscA, oscB], amp });
  }

  noteOff(note, when = this.ctx?.currentTime || 0) {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;
    voice.amp.gain.cancelScheduledValues(when);
    voice.amp.gain.setTargetAtTime(0.0001, when, this.release);
    for (const osc of voice.oscillators) osc.stop(when + this.release + 0.05);
    this.voices.delete(note);
  }

  connectAudio(destination) {
    if (this.output && destination) this.output.connect(destination);
  }

  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }

  serialize() {
    return {
      ...super.serialize(),
      waveform: this.waveform,
      detuneCents: this.detuneCents,
      cutoff: this.cutoff,
      release: this.release,
    };
  }

  hydrate(data = {}) {
    this.waveform = data.waveform || this.waveform;
    this.detuneCents = data.detuneCents ?? this.detuneCents;
    this.cutoff = data.cutoff || this.cutoff;
    this.release = data.release || this.release;
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>♬</span><strong>${this.title}</strong><small>MIDI IN / POLY AUDIO OUT</small></div>
      <label>Wave
        <select class="mini-input" data-param="waveform">${['sine', 'triangle', 'sawtooth', 'square'].map((w) => `<option ${w === this.waveform ? 'selected' : ''}>${w}</option>`).join('')}</select>
      </label>
      <label>Cutoff <input class="mini-input" data-param="cutoff" type="range" min="120" max="9000" value="${this.cutoff}"></label>
      <label>Detune <input class="mini-input" data-param="detune" type="range" min="0" max="24" value="${this.detuneCents}"></label>
      <p class="microcopy">Two oscillators per note with an accessible filter control and stable note release.</p>
    `;
    this.root.querySelector('[data-param="waveform"]').addEventListener('change', (e) => {
      this.waveform = e.target.value;
    });
    this.root.querySelector('[data-param="cutoff"]').addEventListener('input', (e) => {
      this.setParam('cutoff', e.target.value);
    });
    this.root.querySelector('[data-param="detune"]').addEventListener('input', (e) => {
      this.detuneCents = Number(e.target.value) || 0;
    });
  }
}

export class DrumSynthModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('drumsynth'),
      title: config.title || 'Drum Synth',
      kind: 'audio-generator',
      inputs: [{ id: 'midi', type: PortType.MIDI }],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.output = null;
    this.lastHits = [];
    this.noteMap = new Map([
      ['C1', 'kick'],
      ['D1', 'snare'],
      ['F#1', 'hat'],
      ['A#1', 'clap'],
    ]);
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.5;
    }
  }

  receive(packet) {
    if (packet.kind !== PortType.MIDI || packet.type !== 'note-on') return;
    this.trigger(
      this.noteMap.get(packet.note) || 'hat',
      packet.velocity ?? 0.8,
      packetAudioTime(this.ctx, packet)
    );
  }

  trigger(voice, velocity = 0.8, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output) return;
    this.lastHits.push({ voice, velocity, when });
    if (this.lastHits.length > 16) this.lastHits.shift();

    if (voice === 'kick') return this.kick(velocity, when);
    if (voice === 'snare') return this.snare(velocity, when);
    return this.noiseTone(voice, velocity, when);
  }

  kick(velocity, when) {
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.setTargetAtTime(48, when + 0.02, 0.05);
    amp.gain.setValueAtTime(Math.max(0.001, velocity), when);
    amp.gain.setTargetAtTime(0.0001, when + 0.02, 0.08);
    osc.connect(amp);
    amp.connect(this.output);
    osc.start(when);
    osc.stop(when + 0.35);
  }

  snare(velocity, when) {
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const amp = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 180;
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    amp.gain.setValueAtTime(Math.max(0.001, velocity * 0.7), when);
    amp.gain.setTargetAtTime(0.0001, when + 0.015, 0.06);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(this.output);
    osc.start(when);
    osc.stop(when + 0.22);
  }

  noiseTone(voice, velocity, when) {
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const amp = this.ctx.createGain();
    osc.type = voice === 'clap' ? 'square' : 'triangle';
    osc.frequency.value = voice === 'clap' ? 900 : 6200;
    filter.type = 'highpass';
    filter.frequency.value = voice === 'clap' ? 700 : 4800;
    amp.gain.setValueAtTime(Math.max(0.001, velocity * 0.45), when);
    amp.gain.setTargetAtTime(0.0001, when + 0.005, voice === 'clap' ? 0.08 : 0.025);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(this.output);
    osc.start(when);
    osc.stop(when + (voice === 'clap' ? 0.28 : 0.09));
  }

  connectAudio(destination) {
    if (this.output && destination) this.output.connect(destination);
  }

  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }

  serialize() {
    return {
      ...super.serialize(),
      noteMap: Object.fromEntries(this.noteMap),
    };
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>◒</span><strong>${this.title}</strong><small>MIDI IN / DRUM AUDIO OUT</small></div>
      <div class="effect-rack">
        <span>C1 kick</span><span>D1 snare</span><span>F#1 hat</span><span>A#1 clap</span>
      </div>
      <p class="microcopy">A small percussive synth for sequencers and ORCA note packets.</p>
    `;
  }
}
