// V11 Peer DAW/src/core/clips-arrangement.js
// Pure domain model for automation, clip launching, and arrangement playback.

import { PortType } from './contracts.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

export function quantizeBeat(beat = 0, quantizationBeats = 4) {
  const q = Math.max(0.000001, Number(quantizationBeats) || 4);
  const b = Number(beat) || 0;
  return round(Math.ceil((b - 1e-9) / q) * q);
}

export class AutomationOperator {
  constructor(config = {}) {
    this.type = config.type || 'step';
    this.startBeat = Number(config.startBeat ?? 0);
    this.endBeat = Number(config.endBeat ?? this.startBeat);
    this.value = config.value;
    this.from = config.from;
    this.to = config.to;
    this.min = config.min;
    this.max = config.max;
    this.cycles = Number(config.cycles ?? 1);
    this.curve = config.curve || 'linear';
  }

  contains(beat) {
    if (this.type === 'step') return beat >= this.startBeat;
    return beat >= this.startBeat && beat <= this.endBeat;
  }

  valueAt(beat, fallback = 0) {
    if (!this.contains(beat)) return fallback;
    if (this.type === 'step') return Number(this.value ?? fallback);
    const duration = Math.max(0.000001, this.endBeat - this.startBeat);
    const t = clamp((beat - this.startBeat) / duration, 0, 1);
    if (this.type === 'linear') return round(Number(this.from ?? fallback) + (Number(this.to ?? fallback) - Number(this.from ?? fallback)) * t);
    if (this.type === 'lfo') {
      const min = Number(this.min ?? 0);
      const max = Number(this.max ?? 1);
      const mid = (min + max) / 2;
      const amp = (max - min) / 2;
      return round(mid + Math.sin(t * Math.PI * 2 * this.cycles) * amp);
    }
    return fallback;
  }

  serialize() {
    return {
      type: this.type,
      startBeat: this.startBeat,
      endBeat: this.endBeat,
      value: this.value,
      from: this.from,
      to: this.to,
      min: this.min,
      max: this.max,
      cycles: this.cycles,
      curve: this.curve,
    };
  }
}

export class AutomationLane {
  constructor(config = {}) {
    this.targetModuleId = config.targetModuleId || '';
    this.targetParam = config.targetParam || config.target || '';
    this.defaultValue = Number(config.defaultValue ?? 0);
    this.operators = Array.from(config.operators || []).map((op) =>
      op instanceof AutomationOperator ? op : new AutomationOperator(op)
    );
  }

  valueAt(localBeat = 0) {
    let value = this.defaultValue;
    for (const operator of this.operators) {
      if (operator.contains(localBeat)) value = operator.valueAt(localBeat, value);
    }
    return round(value);
  }

  packetAt(globalBeat = 0, localBeat = globalBeat) {
    return createParameterAutomationPacket({
      targetModuleId: this.targetModuleId,
      targetParam: this.targetParam,
      value: this.valueAt(localBeat),
      beat: globalBeat,
    });
  }

  serialize() {
    return {
      targetModuleId: this.targetModuleId,
      targetParam: this.targetParam,
      defaultValue: this.defaultValue,
      operators: this.operators.map((op) => op.serialize()),
    };
  }
}

export function createParameterAutomationPacket({ targetModuleId, targetParam, value, beat }) {
  return {
    kind: PortType.CONTROL,
    type: 'param',
    target: targetParam,
    value,
    targetModuleId,
    beat,
  };
}

export class AutomationClip {
  constructor(config = {}) {
    this.id = config.id || 'automation-clip';
    this.name = config.name || this.id;
    this.lengthBars = Number(config.lengthBars ?? 1);
    this.beatsPerBar = Number(config.beatsPerBar ?? 4);
    this.lanes = Array.from(config.lanes || []).map((lane) =>
      lane instanceof AutomationLane ? lane : new AutomationLane(lane)
    );
  }

  get lengthBeats() {
    return this.lengthBars * this.beatsPerBar;
  }

  localBeat(globalBeat = 0, startBeat = 0) {
    const raw = Number(globalBeat) - Number(startBeat);
    const length = Math.max(0.000001, this.lengthBeats);
    return round(((raw % length) + length) % length);
  }

  controlPacketsAt(globalBeat = 0, startBeat = 0) {
    const localBeat = this.localBeat(globalBeat, startBeat);
    return this.lanes.map((lane) => lane.packetAt(globalBeat, localBeat));
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      lengthBars: this.lengthBars,
      beatsPerBar: this.beatsPerBar,
      lanes: this.lanes.map((lane) => lane.serialize()),
    };
  }
}

export class Clip extends AutomationClip {
  constructor(config = {}) {
    super(config);
    this.channelId = config.channelId || 'channel-1';
    this.midi = Array.from(config.midi || []).map((note, index) => ({
      id: note.id || `${this.id}-note-${index + 1}`,
      beat: Number(note.beat ?? 0),
      note: note.note || 'C4',
      velocity: clamp(note.velocity ?? 0.8, 0, 1),
      duration: Number(note.duration ?? 1),
    }));
    this.lanes = Array.from(config.automation || config.lanes || []).map((lane) =>
      lane instanceof AutomationLane ? lane : new AutomationLane(lane)
    );
  }

  eventsAt(globalBeat = 0, startBeat = 0) {
    const localBeat = this.localBeat(globalBeat, startBeat);
    const midiEvents = this.midi
      .filter((event) => Math.abs(event.beat - localBeat) < 1e-6)
      .map((event) => ({
        kind: PortType.MIDI,
        type: 'note-on',
        note: event.note,
        velocity: event.velocity,
        beat: globalBeat,
        channelId: this.channelId,
        duration: event.duration,
      }));
    return [...midiEvents, ...this.controlPacketsAt(globalBeat, startBeat)];
  }

  serialize() {
    return {
      ...super.serialize(),
      channelId: this.channelId,
      midi: this.midi.map((event) => ({ ...event })),
      automation: this.lanes.map((lane) => lane.serialize()),
    };
  }
}

export class ClipSlot {
  constructor(config = {}) {
    this.channelId = config.channelId || 'channel-1';
    this.quantizationBeats = Number(config.quantizationBeats ?? 4);
    this.clip = config.clip || null;
    this.launchBeat = config.launchBeat ?? (this.clip ? 0 : null);
    this.stopBeat = config.stopBeat ?? null;
  }

  queueLaunch(clip, currentBeat = 0) {
    this.clip = clip;
    this.launchBeat = quantizeBeat(currentBeat, this.quantizationBeats);
    this.stopBeat = null;
    return this.launchBeat;
  }

  queueStop(currentBeat = 0) {
    this.stopBeat = quantizeBeat(currentBeat, this.quantizationBeats);
    return this.stopBeat;
  }

  activeClipAt(beat = 0) {
    if (!this.clip || this.launchBeat == null || beat < this.launchBeat) return null;
    if (this.stopBeat != null && beat >= this.stopBeat) return null;
    return this.clip;
  }
}

export class Arrangement {
  constructor(config = {}) {
    this.clips = [];
    this.loopStartBeat = Number(config.loopStartBeat ?? 0);
    this.loopEndBeat = Number(config.loopEndBeat ?? 0);
    for (const placement of config.clips || []) this.placeClip(placement);
  }

  placeClip({ clip, startBeat = 0, trackId = 'track-1' }) {
    const normalizedClip = clip instanceof Clip ? clip : new Clip(clip);
    const placement = { clip: normalizedClip, startBeat: Number(startBeat), trackId };
    this.clips.push(placement);
    return placement;
  }

  activeClipsAt(beat = 0) {
    return this.clips
      .filter(({ clip, startBeat }) => beat >= startBeat && beat < startBeat + clip.lengthBeats)
      .map((placement) => ({ ...placement, localBeat: round(beat - placement.startBeat) }));
  }

  eventsAt(beat = 0) {
    return this.activeClipsAt(beat).flatMap(({ clip, startBeat }) => clip.eventsAt(beat, startBeat));
  }

  transportPositionAfter(beat = 0, { loop = false } = {}) {
    if (!loop || this.loopEndBeat <= this.loopStartBeat || beat < this.loopEndBeat) return beat;
    const length = this.loopEndBeat - this.loopStartBeat;
    return round(this.loopStartBeat + ((beat - this.loopStartBeat) % length));
  }

  serialize() {
    return {
      loopStartBeat: this.loopStartBeat,
      loopEndBeat: this.loopEndBeat,
      clips: this.clips.map(({ clip, startBeat, trackId }) => ({ clip: clip.serialize(), startBeat, trackId })),
    };
  }
}
