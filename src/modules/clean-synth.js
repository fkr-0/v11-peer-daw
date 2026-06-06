// PeerModGroove/src/modules/clean-synth.js

import { ModuleBase, PortType, midiNoteToFrequency, uid } from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';
import { packetAudioTime } from '../core/scheduler.js';

export class CleanSynthModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('cleansynth'),
      title: config.title || 'Clean Synth',
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
    this.waveform = config.waveform || 'triangle';
    this.cutoff = config.cutoff || 1800;
    this.release = config.release || 0.16;
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = this.cutoff;
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.42;
      this.filter.connect(this.output);
    }
  }

  receive(packet) {
    if (packet.kind === PortType.MIDI) {
      if (packet.type === 'note-on')
        this.noteOn(packet.note, packet.velocity ?? 0.75, packetAudioTime(this.ctx, packet));
      if (packet.type === 'note-off') this.noteOff(packet.note, packetAudioTime(this.ctx, packet));
    }
    if (packet.kind === PortType.CONTROL && packet.type === 'param' && packet.target === 'cutoff') {
      this.cutoff = Number(packet.value) || this.cutoff;
      if (this.filter)
        this.filter.frequency.setTargetAtTime(this.cutoff, this.ctx.currentTime, 0.02);
    }
  }

  noteOn(note, velocity, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output || !this.filter) return;
    this.noteOff(note, when);
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = this.waveform;
    osc.frequency.value = midiNoteToFrequency(note);
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity), when + 0.012);
    amp.gain.setTargetAtTime(velocity * 0.72, when + 0.05, 0.08);
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
      <div class="module-head"><span>◌</span><strong>${escapeHtml(this.title)}</strong><small>MIDI IN / POLISHED AUDIO OUT</small></div>
      <label>Wave
        <select class="mini-input" data-param="waveform">${['sine', 'triangle', 'sawtooth', 'square'].map((w) => `<option ${w === this.waveform ? 'selected' : ''}>${w}</option>`).join('')}</select>
      </label>
      <label>Cutoff <input class="mini-input" data-param="cutoff" type="range" min="180" max="7600" value="${this.cutoff}"></label>
      <p class="microcopy">A cleaner synth voice: simple envelope, filter, one audio output.</p>
    `;
    this.root.querySelector('[data-param="waveform"]').addEventListener('change', (e) => {
      this.waveform = e.target.value;
    });
    this.root.querySelector('[data-param="cutoff"]').addEventListener('input', (e) => {
      this.cutoff = Number(e.target.value);
      if (this.filter && this.ctx)
        this.filter.frequency.setTargetAtTime(this.cutoff, this.ctx.currentTime, 0.02);
    });
  }
}
