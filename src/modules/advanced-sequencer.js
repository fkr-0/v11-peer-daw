import { ModuleBase, PortType, createMidiPacket, uid } from '../core/contracts.js';
// PeerModGroove/src/modules/advanced-sequencer.js
import {
  CONVERTIBLE_TO_PIANOROLL,
  convertToPianoRollConfig,
} from '../core/convertible-to-pianoroll.js';
import { escapeHtml } from '../core/html.js';
import { PianoRollModule } from './piano-roll.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const VALID_LENGTHS = new Set([4, 8, 16]);
const INTERVALS = Object.freeze({ scale: 0, tritone: 6, octave: 12, fifth: 7 });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function noteToMidi(note) {
  const match = String(note).match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  return (Number(match[2]) + 1) * 12 + NOTE_NAMES.indexOf(match[1]);
}

function midiToNote(midi) {
  const value = Math.max(0, Math.min(127, Math.round(midi)));
  const name = NOTE_NAMES[value % 12];
  const octave = Math.floor(value / 12) - 1;
  return `${name}${octave}`;
}

function normalizeLength(length = 16) {
  const value = Number(length);
  return VALID_LENGTHS.has(value) ? value : 16;
}

function normalizeStep(step = {}) {
  return {
    enabled: Boolean(step.enabled),
    velocity: clamp(step.velocity ?? 0.8, 0, 1),
    microTiming: clamp(step.microTiming ?? 0, -0.5, 0.5),
    duration: clamp(step.duration ?? 0.5, 0.05, 4),
  };
}

function normalizeRow(row = {}, index = 0, length = 16) {
  const source = row.steps || [];
  const steps = Array.from({ length }, (_, stepIndex) => normalizeStep(source[stepIndex]));
  return {
    id: row.id || `row-${index + 1}`,
    label: row.label || row.id || `Row ${index + 1}`,
    note: row.note || midiToNote(48 + index),
    steps,
  };
}

function beatDurationSeconds(packet) {
  const bpm = packet.bpm || 120;
  return 60 / bpm;
}

export class BasicSequencerModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('seq'),
      title: config.title || 'Step Sequencer',
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
    this.length = normalizeLength(config.length || config.stepCount || 16);
    this.stepResolutionBeats = config.stepResolutionBeats || 0.25;
    this.rows = (config.rows || this.defaultRows(config.steps)).map((row, index) =>
      normalizeRow(row, index, this.length)
    );
    this.index = 0;
  }

  get [CONVERTIBLE_TO_PIANOROLL]() {
    return true;
  }

  defaultRows(legacySteps = []) {
    if (legacySteps.length) {
      return [
        {
          id: 'legacy',
          label: 'Legacy Row',
          note: 'C3',
          steps: legacySteps.slice(0, this.length).map((note) => ({
            enabled: Boolean(note),
            note,
            velocity: 0.78,
            microTiming: 0,
            duration: 1,
          })),
        },
      ];
    }
    return [
      { id: 'row-1', label: 'Row 1', note: 'C3', steps: [{ enabled: true, velocity: 0.8 }] },
      {
        id: 'row-2',
        label: 'Row 2',
        note: 'G3',
        steps: [{}, {}, { enabled: true, velocity: 0.72 }],
      },
    ];
  }

  setLength(length) {
    this.length = normalizeLength(length);
    this.rows = this.rows.map((row, index) => normalizeRow(row, index, this.length));
    this.index %= this.length;
    this.render();
  }

  setStep(rowId, stepIndex, patch = {}) {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (!row || stepIndex < 0 || stepIndex >= this.length) return;
    row.steps[stepIndex] = normalizeStep({ ...row.steps[stepIndex], ...patch });
    this.render();
  }

  receive(packet) {
    if (packet.kind === PortType.CONTROL && packet.type === 'param') {
      if (packet.target === 'length') this.setLength(packet.value);
      if (packet.target === 'convert-to-pianoroll') this.emitConversion();
      return;
    }
    if (
      packet.kind === PortType.CLOCK ||
      packet.type === 'clock' ||
      packet.type === 'transport:tick'
    ) {
      this.tick(packet);
    }
  }

  tick(packet = {}) {
    const stepIndex = (packet.step ?? this.index) % this.length;
    const baseAt = packet.at ?? packet.audioTime ?? null;
    const beatSeconds = beatDurationSeconds(packet);
    for (const row of this.rows) {
      const step = row.steps[stepIndex];
      if (!step?.enabled) continue;
      const at =
        baseAt == null ? null : Number((baseAt + step.microTiming * beatSeconds).toFixed(6));
      const gate = Number((step.duration * beatSeconds).toFixed(6));
      this.emitPacket(
        createMidiPacket('note-on', {
          note: row.note,
          velocity: step.velocity,
          gate,
          at,
          microTiming: step.microTiming,
        }),
        'midi'
      );
      this.emitPacket(
        createMidiPacket('note-off', {
          note: row.note,
          velocity: 0,
          at: at == null ? null : at + gate,
        }),
        'midi'
      );
    }
    this.index = (stepIndex + 1) % this.length;
    this.render();
  }

  toPianoRollConfig() {
    const notes = [];
    for (const row of this.rows) {
      row.steps.forEach((step, index) => {
        if (!step.enabled) return;
        notes.push({
          id: `${row.id}-${index + 1}`,
          beat: Number((index * this.stepResolutionBeats + step.microTiming).toFixed(6)),
          note: row.note,
          velocity: step.velocity,
          duration: Number((step.duration * this.stepResolutionBeats).toFixed(6)),
          sourceRow: row.id,
        });
      });
    }
    return {
      id: `${this.id}-piano-roll`,
      title: `${escapeHtml(this.title)} Piano Roll`,
      lengthBeats: this.length * this.stepResolutionBeats,
      stepResolutionBeats: this.stepResolutionBeats,
      notes,
    };
  }

  convertToPianoRoll() {
    return new PianoRollModule(convertToPianoRollConfig(this));
  }

  emitConversion() {
    this.emitPacket(
      {
        kind: PortType.CONTROL,
        type: 'replace-module',
        target: this.id,
        value: this.toPianoRollConfig(),
      },
      'control'
    );
  }

  serialize() {
    return {
      ...super.serialize(),
      moduleType: 'sequencer',
      convertible: 'convertible-to-pianoroll',
      length: this.length,
      stepResolutionBeats: this.stepResolutionBeats,
      rows: this.rows.map((row) => ({ ...row, steps: row.steps.map((step) => ({ ...step })) })),
    };
  }

  hydrate(data = {}) {
    this.length = normalizeLength(data.length || this.length);
    this.stepResolutionBeats = data.stepResolutionBeats || this.stepResolutionBeats;
    this.rows = (data.rows || this.rows).map((row, index) => normalizeRow(row, index, this.length));
    this.render();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>▦</span><strong>${escapeHtml(this.title)}</strong><small>CLOCK IN / MIDI OUT · CONVERTIBLE</small></div>
      <div class="effect-rack">
        <label>Length
          <select class="mini-input" data-length>${[4, 8, 16].map((value) => `<option value="${value}" ${value === this.length ? 'selected' : ''}>${value}</option>`).join('')}</select>
        </label>
        <button class="mini-button" data-convert>CONVERT TO PIANO ROLL</button>
      </div>
      <div class="sequencer-grid" role="grid">
        ${this.rows
          .map(
            (row) =>
              `<div class="zone-row" data-row="${row.id}"><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.note)}</small>${row.steps
                .map(
                  (step, index) =>
                    `<span class="step-cell"><button class="mini-button ${step.enabled ? 'active' : ''}" data-step="${index}" title="velocity ${step.velocity} · timing ${step.microTiming}">${step.enabled ? '◆' : '·'}</button><input class="mini-input" data-step-velocity="${index}" type="range" min="0" max="1" step="0.01" value="${step.velocity}" aria-label="${escapeHtml(row.label)} step ${index + 1} velocity"><input class="mini-input" data-step-micro="${index}" type="range" min="-0.5" max="0.5" step="0.01" value="${step.microTiming}" aria-label="${escapeHtml(row.label)} step ${index + 1} micro timing"></span>`
                )
                .join('')}</div>`
          )
          .join('')}
      </div>
      <p class="microcopy">Rows map to MIDI notes. Each active step stores velocity and micro-timing, then can be converted into a piano roll clip.</p>
    `;
    this.root.querySelector('[data-length]').onchange = (event) =>
      this.setLength(event.target.value);
    this.root.querySelector('[data-convert]').onclick = () => this.emitConversion();
    this.root.querySelectorAll('[data-row]').forEach((rowEl) => {
      rowEl.querySelectorAll('[data-step]').forEach((stepEl) => {
        stepEl.onclick = () => {
          const row = this.rows.find((candidate) => candidate.id === rowEl.dataset.row);
          const index = Number(stepEl.dataset.step);
          this.setStep(row.id, index, { enabled: !row.steps[index].enabled });
        };
      });
      rowEl.querySelectorAll('[data-step-velocity]').forEach((input) => {
        input.oninput = (event) => {
          this.setStep(rowEl.dataset.row, Number(event.target.dataset.stepVelocity), {
            velocity: event.target.value,
          });
        };
      });
      rowEl.querySelectorAll('[data-step-micro]').forEach((input) => {
        input.oninput = (event) => {
          this.setStep(rowEl.dataset.row, Number(event.target.dataset.stepMicro), {
            microTiming: event.target.value,
          });
        };
      });
    });
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
    this.root.innerHTML = `<div class="module-head"><span>▤</span><strong>${escapeHtml(this.title)}</strong><small>SCENE CONTROL</small></div><p class="microcopy">bar ${this.bar} · ${this.scenes.join(' → ')}</p>`;
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
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'midi', type: PortType.MIDI }],
    });
    this.notes = config.notes || [];
    this.velocities = new Map();
    for (const note of this.notes) this.velocities.set(note, 0.7);
    this.scale = config.scale || 'chromatic';
    this.interval = config.interval || 'scale';
    this.stepSize = config.stepSize || 1;
    this.noteLength = config.noteLength || 0.25;
    this.repeat = config.repeat || 1;
    this.repeatInverse = Boolean(config.repeatInverse || false);
    this.direction = config.direction || 'up';
    this.octaves = config.octaves || 1;
    this.index = 0;
  }

  receive(packet) {
    if (packet.kind === PortType.MIDI) this.receiveMidi(packet);
    if (packet.kind === PortType.CONTROL && packet.type === 'param')
      this.setParam(packet.target, packet.value);
    if (packet.kind === PortType.CLOCK || packet.type === 'transport:tick') this.tick(packet);
  }

  receiveMidi(packet) {
    if (packet.type === 'note-on') {
      if (!this.notes.includes(packet.note)) this.notes.push(packet.note);
      this.notes.sort((a, b) => noteToMidi(a) - noteToMidi(b));
      this.velocities.set(packet.note, packet.velocity ?? 0.7);
    }
    if (packet.type === 'note-off') {
      this.notes = this.notes.filter((note) => note !== packet.note);
      this.velocities.delete(packet.note);
    }
  }

  setParam(target, value) {
    if (target === 'scale') this.scale = String(value);
    if (target === 'interval') this.interval = String(value);
    if (target === 'direction') this.direction = String(value);
    if (target === 'stepSize') this.stepSize = Math.max(1, Math.round(Number(value) || 1));
    if (target === 'noteLength') this.noteLength = clamp(value, 0.05, 4);
    if (target === 'repeat') this.repeat = Math.max(1, Math.round(Number(value) || 1));
    if (target === 'repeatInverse') this.repeatInverse = Boolean(value);
    if (target === 'octaves') this.octaves = Math.max(1, Math.round(Number(value) || 1));
    this.render();
  }

  arpPattern() {
    if (!this.notes.length) return [];
    const base = [...this.notes].sort((a, b) => noteToMidi(a) - noteToMidi(b));
    const expanded = [];
    for (let octave = 0; octave < this.octaves; octave += 1) {
      for (const note of base) expanded.push(midiToNote(noteToMidi(note) + octave * 12));
    }
    const interval = INTERVALS[this.interval] ?? 0;
    const transformed =
      this.interval === 'tritone'
        ? Array.from({ length: Math.max(2, this.octaves * 2) }, (_, index) =>
            midiToNote(noteToMidi(base[0]) + index * interval)
          )
        : expanded.flatMap((note) => {
            const result = [note];
            if (interval) result.push(midiToNote(noteToMidi(note) + interval));
            return result;
          });
    const repeated = [];
    for (let repeat = 0; repeat < this.repeat; repeat += 1) {
      repeated.push(
        ...(this.repeatInverse && repeat % 2 === 1 ? [...transformed].reverse() : transformed)
      );
    }
    return this.direction === 'down' ? repeated.reverse() : repeated;
  }

  tick(packet = {}) {
    const pattern = this.arpPattern();
    if (!pattern.length) return;
    const note = pattern[this.index % pattern.length];
    const baseNote = this.notes[0] || note;
    const velocity = this.velocities.get(baseNote) ?? 0.7;
    const bpm = packet.bpm || 120;
    const gate = Number(((60 / bpm) * this.noteLength).toFixed(6));
    const at = packet.at || packet.audioTime || null;
    this.emitPacket(createMidiPacket('note-on', { note, velocity, gate, at }), 'midi');
    this.emitPacket(
      createMidiPacket('note-off', { note, velocity: 0, at: at == null ? null : at + gate }),
      'midi'
    );
    this.index += 1;
    this.render();
  }

  serialize() {
    return {
      ...super.serialize(),
      settings: {
        direction: this.direction,
        interval: this.interval,
        noteLength: this.noteLength,
        octaves: this.octaves,
        repeat: this.repeat,
        repeatInverse: this.repeatInverse,
        scale: this.scale,
        stepSize: this.stepSize,
      },
      notes: [...this.notes],
    };
  }

  hydrate(data = {}) {
    const settings = data.settings || data;
    this.scale = settings.scale || this.scale;
    this.interval = settings.interval || this.interval;
    this.stepSize = settings.stepSize || this.stepSize;
    this.noteLength = settings.noteLength || this.noteLength;
    this.repeat = settings.repeat || this.repeat;
    this.repeatInverse = settings.repeatInverse ?? this.repeatInverse;
    this.direction = settings.direction || this.direction;
    this.octaves = settings.octaves || this.octaves;
    this.notes = data.notes || this.notes;
    this.render();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>⌁</span><strong>${escapeHtml(this.title)}</strong><small>MIDI/CONTROL/CLOCK IN · MIDI OUT</small></div>
      <div class="effect-rack">
        <label>Scale <select class="mini-input" data-param="scale">${['chromatic', 'major', 'minor'].map((value) => `<option value="${value}" ${value === this.scale ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Interval <select class="mini-input" data-param="interval">${['scale', 'tritone', 'fifth', 'octave'].map((value) => `<option value="${value}" ${value === this.interval ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Step <input class="mini-input" data-param="stepSize" type="number" min="1" max="16" value="${this.stepSize}"></label>
        <label>Length <input class="mini-input" data-param="noteLength" type="range" min="0.05" max="2" step="0.01" value="${this.noteLength}"></label>
        <label>Repeat <input class="mini-input" data-param="repeat" type="number" min="1" max="16" value="${this.repeat}"></label>
      </div>
      <p class="microcopy">Held notes: ${this.notes.join(' · ') || 'send MIDI in'} · repeat inverse ${this.repeatInverse ? 'on' : 'off'}</p>
    `;
    this.root.querySelectorAll('[data-param]').forEach((el) => {
      el.oninput = (event) => this.setParam(event.target.dataset.param, event.target.value);
      el.onchange = (event) => this.setParam(event.target.dataset.param, event.target.value);
    });
  }
}
