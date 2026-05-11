// PeerModGroove/src/modules/piano-roll.js

import { ModuleBase, PortType, createMidiPacket, uid } from '../core/contracts.js';

export class PianoRollModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('piano'),
      title: config.title || 'Piano Roll',
      kind: 'midi-generator',
      inputs: [
        { id: 'clock', type: PortType.CLOCK },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'midi', type: PortType.MIDI }],
    });
    this.steps = config.steps || 16;
    this.pattern = config.pattern || [
      { step: 0, note: 'C4', velocity: 0.9, gate: 0.45 },
      { step: 4, note: 'E4', velocity: 0.8, gate: 0.45 },
      { step: 8, note: 'G4', velocity: 0.8, gate: 0.45 },
      { step: 12, note: 'B4', velocity: 0.75, gate: 0.45 },
    ];
  }

  receive(packet) {
    if (packet.kind !== PortType.CLOCK || packet.type !== 'step') return;
    const step = packet.step % this.steps;
    for (const note of this.pattern.filter((n) => n.step === step)) {
      this.emitPacket(
        createMidiPacket('note-on', {
          note: note.note,
          velocity: note.velocity,
          gate: note.gate,
          at: packet.at,
        }),
        'midi'
      );
      this.emitPacket(
        createMidiPacket('note-off', { note: note.note, velocity: 0, at: packet.at + note.gate }),
        'midi'
      );
    }
    this.root
      ?.querySelectorAll('[data-step]')
      .forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === step));
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>▦</span><strong>${this.title}</strong><small>MIDI OUT</small></div>
      <div class="roll-grid">
        ${Array.from({ length: this.steps }, (_, step) => `<button data-step="${step}">${this.pattern.some((n) => n.step === step) ? '◆' : '·'}</button>`).join('')}
      </div>
      <p class="microcopy">Autonomous control module: receives clock, emits midi-like note packets only.</p>
    `;
  }
}
