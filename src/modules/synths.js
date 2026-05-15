// V11 Peer DAW/src/modules/synths.js
// Extensible synth modules for the consolidated peer DAW.

import { ModuleBase, PortType, midiNoteToFrequency, uid } from '../core/contracts.js';
import { packetAudioTime } from '../core/scheduler.js';
import { findSynthPreset, listSynthPresets, normalizeSynthPreset } from './synth-presets.js';

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

function setAudioParam(param, value, when = 0, timeConstant = 0.02) {
  if (!param) return;
  if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, when, timeConstant);
  else param.value = value;
}

function makeDriveCurve(amount = 0.4, samples = 256) {
  const curve = new Float32Array(samples);
  const k = Math.max(0, Number(amount) || 0) * 80 + 1;
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / (samples - 1) - 1;
    curve[index] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

class VoiceModuleBase extends ModuleBase {
  receive(packet) {
    if (packet.kind === PortType.MIDI) {
      if (packet.type === 'note-on') this.noteOn(packet.note, packet.velocity ?? 0.75, packetAudioTime(this.ctx, packet));
      if (packet.type === 'note-off') this.noteOff(packet.note, packetAudioTime(this.ctx, packet));
    }
    if (packet.kind === PortType.CONTROL && packet.type === 'param') this.setParam?.(packet.target, packet.value);
  }

  connectAudio(destination) {
    if (this.output && destination) this.output.connect(destination);
  }

  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }
}

export class SubtractiveAnalogSynthModule extends VoiceModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('analogsynth'),
      title: config.title || 'Subtractive Analog Synth',
      kind: 'audio-generator',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.voices = new Map();
    this.output = null;
    this.filter = null;
    this.drive = null;
    this.oscillatorMix = config.oscillatorMix || { saw: 0.65, square: 0.35, sub: 0.22 };
    this.cutoff = config.cutoff ?? 1800;
    this.resonance = config.resonance ?? 5;
    this.filterEnvelopeAmount = config.filterEnvelopeAmount ?? 1800;
    this.attack = config.attack ?? 0.012;
    this.decay = config.decay ?? 0.12;
    this.sustain = config.sustain ?? 0.62;
    this.release = config.release ?? 0.2;
    this.driveAmount = config.driveAmount ?? 0.35;
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = this.cutoff;
      this.filter.Q.value = this.resonance;
      this.drive = this.ctx.createWaveShaper?.() || this.ctx.createGain();
      if ('curve' in this.drive) this.drive.curve = makeDriveCurve(this.driveAmount);
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.36;
      this.filter.connect(this.drive);
      this.drive.connect(this.output);
    }
  }

  setParam(target, value) {
    if (target === 'cutoff') {
      this.cutoff = Number(value) || this.cutoff;
      setAudioParam(this.filter?.frequency, this.cutoff, this.ctx?.currentTime || 0);
    }
    if (target === 'resonance') {
      this.resonance = Number(value) || this.resonance;
      setAudioParam(this.filter?.Q, this.resonance, this.ctx?.currentTime || 0);
    }
    if (target === 'driveAmount') {
      this.driveAmount = Number(value) || this.driveAmount;
      if (this.drive && 'curve' in this.drive) this.drive.curve = makeDriveCurve(this.driveAmount);
    }
  }

  noteOn(note, velocity = 0.75, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.filter) return;
    this.noteOff(note, when);
    const frequency = midiNoteToFrequency(note);
    const amp = this.ctx.createGain();
    const makeOsc = (type, ratio, gainValue, detune = 0) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency * ratio;
      osc.detune.value = detune;
      gain.gain.value = gainValue;
      osc.connect(gain);
      gain.connect(amp);
      osc.start(when);
      return { osc, gain };
    };
    const oscillators = [
      makeOsc('sawtooth', 1, this.oscillatorMix.saw ?? 0.65, -4),
      makeOsc('square', 1, this.oscillatorMix.square ?? 0.35, 3),
      makeOsc('square', 0.5, this.oscillatorMix.sub ?? 0.22, 0),
    ];
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity), when + this.attack);
    amp.gain.setTargetAtTime(Math.max(0.001, velocity * this.sustain), when + this.attack, this.decay);
    setAudioParam(this.filter.frequency, this.cutoff + this.filterEnvelopeAmount, when, 0.01);
    setAudioParam(this.filter.frequency, this.cutoff, when + this.attack, this.decay);
    amp.connect(this.filter);
    this.voices.set(note, { oscillators, amp });
  }

  noteOff(note, when = this.ctx?.currentTime || 0) {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;
    voice.amp.gain.cancelScheduledValues(when);
    voice.amp.gain.setTargetAtTime(0.0001, when, this.release);
    for (const { osc } of voice.oscillators) osc.stop(when + this.release + 0.05);
    this.voices.delete(note);
  }

  serialize() {
    return {
      ...super.serialize(),
      moduleType: 'analogsynth',
      oscillatorMix: this.oscillatorMix,
      cutoff: this.cutoff,
      resonance: this.resonance,
      filterEnvelopeAmount: this.filterEnvelopeAmount,
      attack: this.attack,
      decay: this.decay,
      sustain: this.sustain,
      release: this.release,
      driveAmount: this.driveAmount,
    };
  }

  hydrate(data = {}) {
    Object.assign(this, {
      oscillatorMix: data.oscillatorMix || this.oscillatorMix,
      cutoff: data.cutoff ?? this.cutoff,
      resonance: data.resonance ?? this.resonance,
      filterEnvelopeAmount: data.filterEnvelopeAmount ?? this.filterEnvelopeAmount,
      attack: data.attack ?? this.attack,
      decay: data.decay ?? this.decay,
      sustain: data.sustain ?? this.sustain,
      release: data.release ?? this.release,
      driveAmount: data.driveAmount ?? this.driveAmount,
    });
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>◐</span><strong>${this.title}</strong><small>MIDI IN / ANALOG AUDIO OUT</small></div>
      <label>Cutoff <input class="mini-input" data-param="cutoff" type="range" min="80" max="12000" value="${this.cutoff}"></label>
      <label>Resonance <input class="mini-input" data-param="resonance" type="range" min="0.1" max="24" step="0.1" value="${this.resonance}"></label>
      <label>Drive <input class="mini-input" data-param="driveAmount" type="range" min="0" max="1" step="0.01" value="${this.driveAmount}"></label>
      <p class="microcopy">Three-oscillator subtractive voice: saw, pulse, sub, resonant low-pass filter, envelope, and drive.</p>
    `;
    this.root.querySelectorAll('[data-param]').forEach((el) => el.addEventListener('input', (e) => this.setParam(e.target.dataset.param, e.target.value)));
  }
}

export class FmPhaseSynthModule extends VoiceModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('fmsynth'),
      title: config.title || 'FM / Phase Mod Synth',
      kind: 'audio-generator',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.voices = new Map();
    this.output = null;
    this.carrierRatio = config.carrierRatio ?? 1;
    this.modulatorRatio = config.modulatorRatio ?? 2;
    this.modulationIndex = config.modulationIndex ?? 2.5;
    this.feedback = config.feedback ?? 0;
    this.modulationMode = config.modulationMode || 'frequency';
    this.attack = config.attack ?? 0.01;
    this.release = config.release ?? 0.18;
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.34;
    }
  }

  setParam(target, value) {
    if (target === 'carrierRatio') this.carrierRatio = Number(value) || this.carrierRatio;
    if (target === 'modulatorRatio') this.modulatorRatio = Number(value) || this.modulatorRatio;
    if (target === 'modulationIndex') this.modulationIndex = Number(value) || this.modulationIndex;
  }

  noteOn(note, velocity = 0.75, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output) return;
    this.noteOff(note, when);
    const base = midiNoteToFrequency(note);
    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modDepth = this.ctx.createGain();
    const amp = this.ctx.createGain();
    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.value = base * this.carrierRatio;
    modulator.frequency.value = base * this.modulatorRatio;
    modDepth.gain.value = base * this.modulationIndex;
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity), when + this.attack);
    modulator.connect(modDepth);
    modDepth.connect(carrier.frequency);
    carrier.connect(amp);
    amp.connect(this.output);
    carrier.start(when);
    modulator.start(when);
    this.voices.set(note, { carrier, modulator, modDepth, amp });
  }

  noteOff(note, when = this.ctx?.currentTime || 0) {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;
    voice.amp.gain.cancelScheduledValues(when);
    voice.amp.gain.setTargetAtTime(0.0001, when, this.release);
    voice.carrier.stop(when + this.release + 0.05);
    voice.modulator.stop(when + this.release + 0.05);
    this.voices.delete(note);
  }

  serialize() {
    return {
      ...super.serialize(),
      moduleType: 'fmsynth',
      carrierRatio: this.carrierRatio,
      modulatorRatio: this.modulatorRatio,
      modulationIndex: this.modulationIndex,
      modulationMode: this.modulationMode,
      feedback: this.feedback,
      attack: this.attack,
      release: this.release,
    };
  }

  hydrate(data = {}) {
    this.carrierRatio = data.carrierRatio ?? this.carrierRatio;
    this.modulatorRatio = data.modulatorRatio ?? this.modulatorRatio;
    this.modulationIndex = data.modulationIndex ?? this.modulationIndex;
    this.modulationMode = data.modulationMode || this.modulationMode;
    this.feedback = data.feedback ?? this.feedback;
    this.attack = data.attack ?? this.attack;
    this.release = data.release ?? this.release;
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>∿</span><strong>${this.title}</strong><small>MIDI IN / FM AUDIO OUT</small></div>
      <label>Carrier ratio <input class="mini-input" data-param="carrierRatio" type="number" step="0.01" value="${this.carrierRatio}"></label>
      <label>Mod ratio <input class="mini-input" data-param="modulatorRatio" type="number" step="0.01" value="${this.modulatorRatio}"></label>
      <label>Index <input class="mini-input" data-param="modulationIndex" type="range" min="0" max="12" step="0.01" value="${this.modulationIndex}"></label>
      <p class="microcopy">Two-operator FM/phase-style voice: modulator depth drives carrier frequency for metallic and bell tones.</p>
    `;
    this.root.querySelectorAll('[data-param]').forEach((el) => el.addEventListener('input', (e) => this.setParam(e.target.dataset.param, e.target.value)));
  }
}

export class WavetableSynthModule extends VoiceModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('wavetablesynth'),
      title: config.title || 'Wavetable Synth',
      kind: 'audio-generator',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.voices = new Map();
    this.output = null;
    this.filter = null;
    this.wavetable = config.wavetable || 'classic';
    this.morph = config.morph ?? 0.25;
    this.tableSize = config.tableSize || 32;
    this.attack = config.attack ?? 0.015;
    this.release = config.release ?? 0.16;
    this.cutoff = config.cutoff ?? 4200;
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

  harmonicProfile(name = this.wavetable) {
    const profiles = {
      classic: (n) => 1 / n,
      bright: (n) => 1 / Math.sqrt(n),
      hollow: (n) => (n % 2 ? 1 / n : 0),
      glass: (n) => (n % 3 === 0 ? 0.8 / n : 0.15 / n),
    };
    return profiles[name] || profiles.classic;
  }

  createMorphedWave() {
    const real = new Float32Array(this.tableSize);
    const imag = new Float32Array(this.tableSize);
    const base = this.harmonicProfile(this.wavetable);
    const alternate = this.harmonicProfile(this.wavetable === 'bright' ? 'hollow' : 'bright');
    for (let index = 1; index < this.tableSize; index += 1) {
      const a = base(index);
      const b = alternate(index);
      imag[index] = a * (1 - this.morph) + b * this.morph;
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  setParam(target, value) {
    if (target === 'wavetable') this.wavetable = String(value || this.wavetable);
    if (target === 'morph') this.morph = Math.max(0, Math.min(1, Number(value) || 0));
    if (target === 'cutoff') {
      this.cutoff = Number(value) || this.cutoff;
      setAudioParam(this.filter?.frequency, this.cutoff, this.ctx?.currentTime || 0);
    }
  }

  noteOn(note, velocity = 0.75, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.filter) return;
    this.noteOff(note, when);
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.frequency.value = midiNoteToFrequency(note);
    osc.setPeriodicWave(this.createMorphedWave());
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity), when + this.attack);
    osc.connect(amp);
    amp.connect(this.filter);
    osc.start(when);
    this.voices.set(note, { osc, amp });
  }

  noteOff(note, when = this.ctx?.currentTime || 0) {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;
    voice.amp.gain.cancelScheduledValues(when);
    voice.amp.gain.setTargetAtTime(0.0001, when, this.release);
    voice.osc.stop(when + this.release + 0.05);
    this.voices.delete(note);
  }

  serialize() {
    return {
      ...super.serialize(),
      moduleType: 'wavetablesynth',
      wavetable: this.wavetable,
      morph: this.morph,
      tableSize: this.tableSize,
      cutoff: this.cutoff,
      attack: this.attack,
      release: this.release,
    };
  }

  hydrate(data = {}) {
    this.wavetable = data.wavetable || this.wavetable;
    this.morph = data.morph ?? this.morph;
    this.tableSize = data.tableSize || this.tableSize;
    this.cutoff = data.cutoff ?? this.cutoff;
    this.attack = data.attack ?? this.attack;
    this.release = data.release ?? this.release;
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>≋</span><strong>${this.title}</strong><small>MIDI IN / WAVETABLE AUDIO OUT</small></div>
      <label>Table <select class="mini-input" data-param="wavetable">${['classic', 'bright', 'hollow', 'glass'].map((name) => `<option value="${name}" ${name === this.wavetable ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
      <label>Morph <input class="mini-input" data-param="morph" type="range" min="0" max="1" step="0.01" value="${this.morph}"></label>
      <label>Cutoff <input class="mini-input" data-param="cutoff" type="range" min="180" max="12000" value="${this.cutoff}"></label>
      <p class="microcopy">Harmonic wavetable oscillator with morphing partial profiles and a smoothing low-pass output.</p>
    `;
    this.root.querySelectorAll('[data-param]').forEach((el) => {
      const event = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(event, (e) => this.setParam(e.target.dataset.param, e.target.value));
    });
  }
}

function applySynthPresetToModule(module, synthKey, preset = {}) {
  const normalized = normalizeSynthPreset(preset);
  if (normalized.synth !== synthKey) {
    throw new Error(`Incompatible synth preset: expected ${synthKey}, got ${normalized.synth}`);
  }
  module.hydrate?.(normalized.params || {});
  module.currentPreset = normalized;
  module.render?.();
  return module.exportPreset?.() || normalized;
}

function exportSynthPresetFromModule(module, synthKey) {
  const serialized = module.serialize();
  const { id: _id, title: _title, kind: _kind, inputs: _inputs, outputs: _outputs, moduleType: _moduleType, noteMap: _noteMap, ...params } = serialized;
  return normalizeSynthPreset({
    synth: synthKey,
    slug: module.currentPreset?.slug || `${module.id}-preset`,
    title: module.currentPreset?.title || `${module.title} Preset`,
    category: module.currentPreset?.category || 'user',
    description: module.currentPreset?.description || `Exported from ${module.title}`,
    tags: module.currentPreset?.tags || ['user'],
    params,
  });
}

function addSynthPresetApi(ClassRef, synthKey) {
  ClassRef.prototype.importPreset = function importPreset(preset = {}) {
    return applySynthPresetToModule(this, synthKey, preset);
  };
  ClassRef.prototype.importPresetJson = function importPresetJson(json) {
    return this.importPreset(JSON.parse(json));
  };
  ClassRef.prototype.exportPreset = function exportPreset() {
    return exportSynthPresetFromModule(this, synthKey);
  };
  ClassRef.prototype.exportPresetJson = function exportPresetJson() {
    return JSON.stringify(this.exportPreset(), null, 2);
  };
}

function decorateSynthPresetUi(ClassRef, synthKey) {
  const originalRender = ClassRef.prototype.render;
  ClassRef.prototype.render = function renderWithSynthPresetUi() {
    originalRender.call(this);
    if (!this.root || this.root.querySelector('[data-synth-preset-ui]')) return;
    const presets = listSynthPresets({ synth: synthKey });
    const ui = document.createElement('div');
    ui.className = 'effect-rack synth-preset-ui';
    ui.dataset.synthPresetUi = synthKey;
    ui.innerHTML = `
      <select class="mini-input" data-synth-preset-select>
        <option value="">Load preset…</option>
        ${presets.map((preset) => `<option value="${preset.slug}">${preset.title}</option>`).join('')}
      </select>
      <textarea class="mini-input" data-synth-preset-json rows="4" placeholder="synth preset JSON import/export"></textarea>
      <div class="button-row">
        <button class="mini-button" type="button" data-synth-preset-export>EXPORT PRESET</button>
        <button class="mini-button" type="button" data-synth-preset-import>IMPORT PRESET</button>
      </div>
    `;
    this.root.appendChild(ui);
    ui.querySelector('[data-synth-preset-select]').addEventListener('change', (event) => {
      const preset = findSynthPreset(event.target.value);
      if (preset) this.importPreset(preset);
    });
    ui.querySelector('[data-synth-preset-export]').addEventListener('click', () => {
      ui.querySelector('[data-synth-preset-json]').value = this.exportPresetJson();
    });
    ui.querySelector('[data-synth-preset-import]').addEventListener('click', () => {
      const json = ui.querySelector('[data-synth-preset-json]').value.trim();
      if (json) this.importPresetJson(json);
    });
  };
}

addSynthPresetApi(SubtractiveAnalogSynthModule, 'analogsynth');
addSynthPresetApi(FmPhaseSynthModule, 'fmsynth');
addSynthPresetApi(WavetableSynthModule, 'wavetablesynth');
decorateSynthPresetUi(SubtractiveAnalogSynthModule, 'analogsynth');
decorateSynthPresetUi(FmPhaseSynthModule, 'fmsynth');
decorateSynthPresetUi(WavetableSynthModule, 'wavetablesynth');
