// PeerModGroove/src/modules/advanced-sequencer.js
import { ModuleBase, PortType, createMidiPacket, uid } from '../core/contracts.js';

export class BasicSequencerModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('seq'),
      title: config.title || 'Basic Sequencer',
      kind: 'midi-generator',
      inputs: [
        { id: 'clock', type: PortType.CLOCK },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'midi', type: PortType.MIDI }],
    });
    this.steps = config.steps || [
      'C3',
      '',
      'G3',
      '',
      'C4',
      '',
      'G3',
      '',
      'D3',
      '',
      'A3',
      '',
      'D4',
      '',
      'A3',
      '',
    ];
    this.index = 0;
  }
  receive(packet) {
    if (
      packet.kind === PortType.CLOCK ||
      packet.type === 'clock' ||
      packet.type === 'transport:tick'
    )
      this.tick(packet);
  }
  tick(packet = {}) {
    const note = this.steps[this.index % this.steps.length];
    if (note)
      this.emitPacket(
        createMidiPacket('note-on', {
          note,
          velocity: 0.78,
          gate: 0.25,
          at: packet.at || packet.audioTime || null,
          dueAt: packet.dueAt,
          audioTime: packet.audioTime,
        }),
        'midi'
      );
    this.index = (this.index + 1) % this.steps.length;
    this.render();
  }
  render() {
    if (!this.root) return;
    this.root.innerHTML = `<div class="module-head"><span>▦</span><strong>${this.title}</strong><small>CLOCK IN / MIDI OUT</small></div><div class="microcopy">${this.steps.map((s, i) => `<span style="${i === this.index ? 'color:#ffd166' : ''}">${s || '·'}</span>`).join(' ')}</div>`;
  }
}

export class ArrangerModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('arranger'),
      title: config.title || 'Arranger',
      kind: 'control-generator',
      inputs: [
        { id: 'clock', type: PortType.CLOCK },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'control', type: PortType.CONTROL }],
    });
    this.scenes = config.scenes || ['intro', 'main', 'break', 'main'];
    this.bar = 0;
  }
  receive(packet) {
    if (packet.kind === PortType.CLOCK || packet.type === 'transport:tick') {
      const scene = this.scenes[Math.floor(this.bar / 16) % this.scenes.length];
      this.emitPacket(
        {
          kind: PortType.CONTROL,
          type: 'scene',
          value: scene,
          bar: this.bar,
          at: packet.at || packet.audioTime || null,
        },
        'control'
      );
      this.bar += 1;
      this.render();
    }
  }
  render() {
    if (!this.root) return;
    this.root.innerHTML = `<div class="module-head"><span>▤</span><strong>${this.title}</strong><small>SCENE CONTROL</small></div><p class="microcopy">bar ${this.bar} · ${this.scenes.join(' → ')}</p>`;
  }
}

export class ArpMidiGeneratorModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('arp'),
      title: config.title || 'ARP MIDI Generator',
      kind: 'midi-generator',
      inputs: [
        { id: 'clock', type: PortType.CLOCK },
        { id: 'midi', type: PortType.MIDI },
      ],
      outputs: [{ id: 'midi', type: PortType.MIDI }],
    });
    this.chord = config.chord || ['C3', 'E3', 'G3', 'B3'];
    this.index = 0;
  }
  receive(packet) {
    if (packet.kind === PortType.MIDI && packet.type === 'note-on')
      this.chord = [packet.note, ...this.chord.slice(0, 3)];
    if (packet.kind === PortType.CLOCK || packet.type === 'transport:tick') {
      const note = this.chord[this.index % this.chord.length];
      this.emitPacket(
        createMidiPacket('note-on', {
          note,
          velocity: 0.7,
          gate: 0.2,
          at: packet.at || packet.audioTime || null,
          dueAt: packet.dueAt,
          audioTime: packet.audioTime,
        }),
        'midi'
      );
      this.index += 1;
      this.render();
    }
  }
  render() {
    if (!this.root) return;
    this.root.innerHTML = `<div class="module-head"><span>⌁</span><strong>${this.title}</strong><small>CLOCK/MIDI IN / MIDI OUT</small></div><p class="microcopy">${this.chord.join(' · ')}</p>`;
  }
}
