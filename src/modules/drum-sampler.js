// V11 Peer DAW/src/modules/drum-sampler.js
// Dedicated pad-based drum sampler with pad assignment and swing metadata.

import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { packetAudioTime } from '../core/scheduler.js';

const DEFAULT_PADS = Object.freeze([
  { id: 'kick', note: 'C1', name: 'Kick', chokeGroup: 'drums', gain: 1, pan: 0 },
  { id: 'snare', note: 'D1', name: 'Snare', chokeGroup: 'drums', gain: 1, pan: 0 },
  { id: 'hat', note: 'F#1', name: 'Closed Hat', chokeGroup: 'hats', gain: 0.85, pan: 0 },
  { id: 'openhat', note: 'A#1', name: 'Open Hat', chokeGroup: 'hats', gain: 0.85, pan: 0 },
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizePad(pad = {}) {
  return {
    id: String(pad.id || 'pad'),
    note: pad.note || 'C1',
    name: pad.name || pad.id || 'Pad',
    chokeGroup: pad.chokeGroup || null,
    gain: clamp(pad.gain ?? 1, 0, 2),
    pan: clamp(pad.pan ?? 0, -1, 1),
    buffer: pad.buffer || null,
  };
}

export class DrumSamplerModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('drumsampler'),
      title: config.title || 'Drum Sampler',
      kind: 'audio-source',
      inputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.output = null;
    this.swing = config.swing || 'swing50';
    this.swingResolution = config.swingResolution || '1/8';
    this.attack = config.attack ?? 0.005;
    this.release = config.release ?? 0.02;
    this.pads = new Map();
    for (const pad of config.pads || DEFAULT_PADS) this.assignPad(pad.id, pad);
    this.activeByChokeGroup = new Map();
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.9;
    }
  }

  assignPad(id, assignment = {}) {
    const existing = this.pads.get(id) || DEFAULT_PADS.find((pad) => pad.id === id) || { id };
    const pad = normalizePad({ ...existing, ...assignment, id });
    this.pads.set(id, pad);
    this.render();
    return pad;
  }

  padForNote(note) {
    return Array.from(this.pads.values()).find((pad) => pad.note === note);
  }

  receive(packet) {
    if (packet.kind === PortType.MIDI && packet.type === 'note-on') {
      this.trigger(packet.note, packet.velocity ?? 0.85, packetAudioTime(this.ctx, packet));
    }
    if (packet.kind === PortType.CONTROL && packet.type === 'pad') {
      this.assignPad(packet.padId, packet.assignment || {});
    }
    if (packet.kind === PortType.CONTROL && packet.type === 'param') {
      if (packet.target === 'swing') this.swing = packet.value;
      if (packet.target === 'swingResolution') this.swingResolution = packet.value;
      this.render();
    }
  }

  trigger(note, velocity = 0.85, when = this.ctx?.currentTime || 0) {
    if (!this.ctx || !this.output) return;
    const pad = this.padForNote(note);
    if (!pad) return;
    if (pad.chokeGroup) {
      this.activeByChokeGroup.get(pad.chokeGroup)?.stop?.(when);
    }
    if (!pad.buffer) return;

    const source = this.ctx.createBufferSource();
    const amp = this.ctx.createGain();
    source.buffer = pad.buffer;
    source.playbackRate.value = 1;
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(velocity * pad.gain, when + this.attack);
    amp.gain.setTargetAtTime(0.0001, when + pad.buffer.duration, this.release);
    source.connect(amp);
    amp.connect(this.output);
    source.start(when, 0, pad.buffer.duration);
    source.stop(when + pad.buffer.duration + this.release + 0.05);
    if (pad.chokeGroup) this.activeByChokeGroup.set(pad.chokeGroup, source);
  }

  serialize() {
    return {
      ...super.serialize(),
      swing: this.swing,
      swingResolution: this.swingResolution,
      pads: Array.from(this.pads.values()).map((pad) => ({
        id: pad.id,
        note: pad.note,
        name: pad.name,
        chokeGroup: pad.chokeGroup,
        gain: pad.gain,
        pan: pad.pan,
      })),
    };
  }

  hydrate(data = {}) {
    this.swing = data.swing || this.swing;
    this.swingResolution = data.swingResolution || this.swingResolution;
    this.pads.clear();
    for (const pad of data.pads || DEFAULT_PADS) this.assignPad(pad.id, pad);
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
    const pads = Array.from(this.pads.values());
    this.root.innerHTML = `
      <div class="module-head"><span>▣</span><strong>${this.title}</strong><small>MIDI IN / PAD AUDIO OUT</small></div>
      <div class="effect-rack">
        <label>Swing
          <select class="mini-input" data-param="swing">${['swing50', 'swing54', 'swing57', 'swing60', 'swing62', 'swing66', 'swing75', 'swing90'].map((value) => `<option value="${value}" ${value === this.swing ? 'selected' : ''}>${value}</option>`).join('')}</select>
        </label>
        <label>Resolution
          <select class="mini-input" data-param="swingResolution">${['1/4', '1/8', '1/16'].map((value) => `<option value="${value}" ${value === this.swingResolution ? 'selected' : ''}>${value}</option>`).join('')}</select>
        </label>
      </div>
      <div class="pad-grid">${pads.map((pad) => `<button class="mini-button" data-pad="${pad.id}"><strong>${pad.id}</strong><small>${pad.note} · ${pad.name}</small></button>`).join('')}</div>
      <p class="microcopy">Assign pads to MIDI notes and trigger them from piano-roll or sequencer modules.</p>
    `;
    this.root.querySelectorAll('[data-param]').forEach((el) => {
      el.addEventListener('change', (event) => {
        if (event.target.dataset.param === 'swing') this.swing = event.target.value;
        if (event.target.dataset.param === 'swingResolution')
          this.swingResolution = event.target.value;
      });
    });
  }
}
