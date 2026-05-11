// PeerModGroove/src/core/contracts.js
// Minimal JSON-safe contracts for autonomous modules and patch packets.

export const PortType = Object.freeze({
  MIDI: 'midi',
  CONTROL: 'control',
  AUDIO: 'audio',
  CLOCK: 'clock',
});

export function uid(prefix = 'pmg') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function midiNoteToFrequency(note) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const match = String(note).match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 440;
  const [, name, octaveText] = match;
  const octave = Number(octaveText);
  const midi = (octave + 1) * 12 + names.indexOf(name);
  return 440 * 2 ** ((midi - 69) / 12);
}

export function createMidiPacket(type, data = {}) {
  return {
    kind: PortType.MIDI,
    type,
    at: null,
    channel: 'main',
    ...data,
  };
}

export function createControlPacket(type, data = {}) {
  return {
    kind: PortType.CONTROL,
    type,
    at: Date.now(),
    ...data,
  };
}

export class ModuleBase extends EventTarget {
  constructor({
    id = uid('mod'),
    title = 'Module',
    kind = 'utility',
    inputs = [],
    outputs = [],
  } = {}) {
    super();
    this.id = id;
    this.title = title;
    this.kind = kind;
    this.inputs = inputs;
    this.outputs = outputs;
    this.root = null;
    this.ctx = null;
  }

  emitPacket(packet, outputId = 'out') {
    this.dispatchEvent(new CustomEvent('packet', { detail: { module: this, outputId, packet } }));
  }

  mount(root) {
    this.root = root;
    this.render();
  }

  render() {}
  unmount() {
    if (this.root) this.root.innerHTML = '';
  }
  async start(context) {
    this.ctx = context;
  }
  stop() {}
  receive(_packet, _inputId = 'in') {}
  connectAudio(_destination, _outputId = 'audio') {}
  disconnectAudio(_outputId = 'audio') {}
  serialize() {
    return { id: this.id, title: this.title, kind: this.kind };
  }
  hydrate(_data) {}
}
