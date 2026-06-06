// PeerModGroove/src/modules/ocra-grid.js
// OCRA/ORCA-inspired autonomous grid: emits midi-like control and owns a tiny submixer for click voices.

import { ModuleBase, PortType, createMidiPacket, uid } from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';

export class OcraGridModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('ocra'),
      title: config.title || 'OCRA Grid',
      kind: 'midi-generator',
      inputs: [
        { id: 'clock', type: PortType.CLOCK },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'audio', type: PortType.AUDIO },
      ],
    });
    this.width = 8;
    this.height = 4;
    this.cursor = 0;
    this.rows = config.rows || ['C4.E4.G4.', '....B4..', 'G3...C4.', '....E3..'];
    this.output = null;
    this.clickGain = null;
    this.clickEnabled = true;
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.18;
      this.clickGain = this.ctx.createGain();
      this.clickGain.gain.value = 0.5;
      this.clickGain.connect(this.output);
    }
  }

  receive(packet) {
    if (packet.kind !== PortType.CLOCK || packet.type !== 'step') return;
    this.cursor = packet.step % this.width;
    for (const note of this.notesAt(this.cursor)) {
      this.emitPacket(
        createMidiPacket('note-on', { note, velocity: 0.72, gate: 0.35, at: packet.at }),
        'midi'
      );
      this.emitPacket(
        createMidiPacket('note-off', { note, velocity: 0, at: packet.at + 0.35 }),
        'midi'
      );
      if (this.clickEnabled) this.click(note);
    }
    this.renderGridCursor();
  }

  notesAt(col) {
    const out = [];
    for (const row of this.rows) {
      const cell = row.slice(col * 2, col * 2 + 2).trim();
      if (/^[A-G][#b]?\d$/.test(cell)) out.push(cell.replace('b', '#'));
    }
    return out;
  }

  click() {
    if (!this.ctx || !this.clickGain) return;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    amp.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.2, this.ctx.currentTime + 0.003);
    amp.gain.setTargetAtTime(0.0001, this.ctx.currentTime + 0.025, 0.02);
    osc.connect(amp);
    amp.connect(this.clickGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
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
      <div class="module-head"><span>▧</span><strong>${escapeHtml(this.title)}</strong><small>CLOCK IN / MIDI + SUBMIX AUDIO OUT</small></div>
      <div class="ocra-grid" spellcheck="false">
        ${this.rows.map((row, idx) => `<input data-row="${idx}" value="${row}">`).join('')}
      </div>
      <label class="inline-check"><input type="checkbox" ${this.clickEnabled ? 'checked' : ''}> internal click submix</label>
      <p class="microcopy">ORCA-alluded grid: compact text rows emit MIDI-like notes. Own mini mixer can coexist with master.</p>
    `;
    this.root.querySelectorAll('[data-row]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const row = Number(e.target.dataset.row);
        this.rows[row] = e.target.value.padEnd(this.width * 2, '.').slice(0, this.width * 2);
      });
    });
    this.root.querySelector('.inline-check input').addEventListener('change', (e) => {
      this.clickEnabled = e.target.checked;
    });
    this.renderGridCursor();
  }

  renderGridCursor() {
    if (!this.root) return;
    this.root.querySelectorAll('[data-row]').forEach((input) => {
      input.style.setProperty('--cursor-col', this.cursor);
    });
  }
}
