// PeerModGroove/src/modules/piano-roll.js

import {
  ModuleBase,
  PortType,
  createControlPacket,
  createMidiPacket,
  uid,
} from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';
import { createTheoryPattern } from '../core/music-theory-patterns.js';

const SWING_AMOUNTS = Object.freeze({
  swing50: 0.5,
  swing54: 0.54,
  swing57: 0.57,
  swing60: 0.6,
  swing62: 0.62,
  swing66: 0.66,
  swing75: 0.75,
  swing90: 0.9,
});

const RESOLUTION_BEATS = Object.freeze({
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
});

function normalizeNote(note = {}, index = 0) {
  return {
    id: note.id || `note-${index + 1}`,
    kind: note.kind || PortType.MIDI,
    type: note.type || 'note-on',
    beat: Number(note.beat ?? note.step ?? 0),
    note: note.note || 'C4',
    velocity: Number(note.velocity ?? 0.8),
    duration: Number(note.duration ?? note.gate ?? 0.45),
    target: note.target,
    value: note.value,
  };
}

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
      outputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'control', type: PortType.CONTROL },
      ],
    });
    this.stepResolutionBeats = config.stepResolutionBeats || 0.25;
    this.lengthBeats = config.lengthBeats || (config.steps || 16) * this.stepResolutionBeats;
    this.steps = Math.round(this.lengthBeats / this.stepResolutionBeats);
    const pattern =
      config.notes ||
      (config.pattern || []).map((note) => ({
        ...note,
        beat: note.beat ?? note.step * this.stepResolutionBeats,
        duration: note.duration ?? note.gate,
      }));
    this.notes = (
      pattern.length
        ? pattern
        : [
            { beat: 0, note: 'C4', velocity: 0.9, duration: 0.45 },
            { beat: 1, note: 'E4', velocity: 0.8, duration: 0.45 },
            { beat: 2, note: 'G4', velocity: 0.8, duration: 0.45 },
            { beat: 3, note: 'B4', velocity: 0.75, duration: 0.45 },
          ]
    ).map(normalizeNote);
    this.swing = config.swing || { amount: 'swing50', resolution: '1/8' };
  }

  get pattern() {
    return this.notes.map((note) => ({
      ...note,
      step: Math.round(note.beat / this.stepResolutionBeats),
      gate: note.duration,
    }));
  }

  setVelocity(noteId, velocity) {
    const note = this.notes.find((candidate) => candidate.id === noteId);
    if (note) note.velocity = Math.min(1, Math.max(0, Number(velocity)));
    this.render();
  }

  applySwingToClip({ amount = 'swing60', resolution = '1/8' } = {}) {
    const swingRatio = SWING_AMOUNTS[amount] ?? 0.5;
    const resolutionBeats = RESOLUTION_BEATS[resolution] ?? 0.5;
    const pairBeats = resolutionBeats * 2;
    this.notes = this.notes.map((note) => {
      const pairIndex = Math.floor(note.beat / pairBeats);
      const pairStart = pairIndex * pairBeats;
      const relative = note.beat - pairStart;
      if (Math.abs(relative - resolutionBeats) < 1e-9) {
        return { ...note, beat: Number((pairStart + pairBeats * swingRatio).toFixed(6)) };
      }
      return note;
    });
    this.swing = { amount, resolution };
    this.render();
  }

  receive(packet) {
    if (packet.kind === PortType.CONTROL && packet.type === 'apply-swing') {
      this.applySwingToClip({ amount: packet.amount, resolution: packet.resolution });
      return;
    }
    if (packet.kind === PortType.CONTROL && packet.type === 'apply-theory-pattern') {
      this.applyTheoryPattern(packet.pattern || {});
      return;
    }
    if (packet.kind !== PortType.CLOCK || packet.type !== 'step') return;
    const beat = ((packet.step || 0) * this.stepResolutionBeats) % this.lengthBeats;
    for (const note of this.notesAtBeat(beat)) this.emitNote(note, packet.at ?? 0);
    this.root
      ?.querySelectorAll('[data-step]')
      .forEach((el) =>
        el.classList.toggle('active', Number(el.dataset.step) === packet.step % this.steps)
      );
  }

  applyTheoryPattern(pattern = {}) {
    this.notes = createTheoryPattern(pattern).map(normalizeNote);
    this.lengthBeats = Math.max(
      this.stepResolutionBeats,
      Number(pattern.lengthBeats || 0),
      Number(pattern.beatsPerChord || 0) * Array.from(pattern.progression || []).length,
      Math.ceil(Math.max(0, ...this.notes.map((note) => note.beat + note.duration)))
    );
    this.steps = Math.ceil(this.lengthBeats / this.stepResolutionBeats);
    this.render();
  }

  notesAtBeat(beat) {
    return this.notes.filter((note) => Math.abs(note.beat - beat) < 1e-9);
  }

  emitNote(note, at) {
    if (note.kind === PortType.CONTROL) {
      const packet = createControlPacket(note.type || 'param', {
        at,
        target: note.target,
        value: note.value,
      });
      this.emitPacket(packet, 'control');
      return;
    }
    this.emitPacket(
      createMidiPacket('note-on', {
        note: note.note,
        velocity: note.velocity,
        gate: note.duration,
        at,
      }),
      'midi'
    );
    this.emitPacket(
      createMidiPacket('note-off', { note: note.note, velocity: 0, at: at + note.duration }),
      'midi'
    );
  }

  serialize() {
    return {
      ...super.serialize(),
      lengthBeats: this.lengthBeats,
      stepResolutionBeats: this.stepResolutionBeats,
      swing: this.swing,
      notes: this.notes.map((note) => ({ ...note })),
    };
  }

  hydrate(data = {}) {
    this.lengthBeats = data.lengthBeats || this.lengthBeats;
    this.stepResolutionBeats = data.stepResolutionBeats || this.stepResolutionBeats;
    this.steps = Math.round(this.lengthBeats / this.stepResolutionBeats);
    this.swing = data.swing || this.swing;
    this.notes = (data.notes || this.notes).map(normalizeNote);
    this.render();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>▦</span><strong>${escapeHtml(this.title)}</strong><small>MIDI/CONTROL OUT</small></div>
      <div class="effect-rack">
        <label>Swing
          <select class="mini-input" data-swing>${Object.keys(SWING_AMOUNTS)
            .map(
              (value) =>
                `<option value="${value}" ${value === this.swing.amount ? 'selected' : ''}>${value}</option>`
            )
            .join('')}</select>
        </label>
        <label>Grid
          <select class="mini-input" data-resolution>${Object.keys(RESOLUTION_BEATS)
            .map(
              (value) =>
                `<option value="${value}" ${value === this.swing.resolution ? 'selected' : ''}>${value}</option>`
            )
            .join('')}</select>
        </label>
        <button class="mini-button" data-apply-swing>APPLY SWING</button>
      </div>
      <div class="roll-grid">
        ${Array.from({ length: this.steps }, (_, step) => `<button data-step="${step}">${this.notes.some((n) => Math.round(n.beat / this.stepResolutionBeats) === step) ? '◆' : '·'}</button>`).join('')}
      </div>
      <div class="effect-rack">${this.notes.map((note) => `<label>${note.note || note.target}@${note.beat}<input class="mini-input" data-velocity="${note.id}" type="range" min="0" max="1" step="0.01" value="${note.velocity ?? 0}"></label>`).join('')}</div>
      <p class="microcopy">Receives clock, emits MIDI/control packets with per-note velocity. Apply MPC-style swing destructively to clip notes.</p>
    `;
    this.root.querySelector('[data-apply-swing]').onclick = () =>
      this.applySwingToClip({
        amount: this.root.querySelector('[data-swing]').value,
        resolution: this.root.querySelector('[data-resolution]').value,
      });
    this.root.querySelectorAll('[data-velocity]').forEach((el) => {
      el.oninput = (event) => this.setVelocity(event.target.dataset.velocity, event.target.value);
    });
  }
}
