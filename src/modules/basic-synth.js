// PeerModGroove/src/modules/basic-synth.js

import { ModuleBase, PortType, midiNoteToFrequency, uid } from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';
import { packetAudioTime } from '../core/scheduler.js';

export class BasicSynthModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('synth'),
      title: config.title || 'Basic Synth Voice',
      kind: 'audio-generator',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.output = null;
    this.voices = new Map();
    this.waveform = config.waveform || 'sawtooth';
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.35;
    }
  }

  receive(packet) {
    if (packet.kind !== PortType.MIDI) return;
    if (packet.type === 'note-on')
      this.noteOn(packet.note, packet.velocity ?? 0.8, packetAudioTime(this.ctx, packet));
    if (packet.type === 'note-off') this.noteOff(packet.note, packetAudioTime(this.ctx, packet));
  }

  noteOn(note, velocity, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output) return;
    this.noteOff(note, when);
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = this.waveform;
    osc.frequency.value = midiNoteToFrequency(note);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, velocity), when + 0.01);
    osc.connect(env);
    env.connect(this.output);
    osc.start(when);
    this.voices.set(note, { osc, env });
  }

  noteOff(note, when = this.ctx?.currentTime || 0) {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;
    voice.env.gain.cancelScheduledValues(when);
    voice.env.gain.setTargetAtTime(0.0001, when, 0.05);
    voice.osc.stop(when + 0.18);
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
      <div class="module-head"><span>◍</span><strong>${escapeHtml(this.title)}</strong><small>MIDI IN / AUDIO OUT</small></div>
      <select class="mini-input">
        ${['sine', 'sawtooth', 'square', 'triangle'].map((w) => `<option ${w === this.waveform ? 'selected' : ''}>${w}</option>`).join('')}
      </select>
      <p class="microcopy">Receives midi-like control packets and emits sound into the mixer.</p>
    `;
    this.root.querySelector('select').addEventListener('change', (e) => {
      this.waveform = e.target.value;
    });
  }
}
