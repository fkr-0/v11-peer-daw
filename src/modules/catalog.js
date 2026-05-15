// V11 Peer DAW/src/modules/catalog.js
// Canonical consolidated module catalog for the V11 peer DAW.

import { ArpMidiGeneratorModule, BasicSequencerModule } from './advanced-sequencer.js';
import { BasicSynthModule } from './basic-synth.js';
import { ChannelStripModule, MixerDeskModule } from './channel-strip.js';
import { CleanSamplerModule } from './clean-sampler.js';
import { CleanSynthModule } from './clean-synth.js';
import { ClockModule } from './clock.js';
import { DrumSamplerModule } from './drum-sampler.js';
import {
  BeatRepeatModule,
  BpmBeatLooperModule,
  DelayModule,
  DubEchoModule,
  FlangerModule,
  GrainDelayModule,
  PhaserModule,
  PitchShiftModule,
  ReverbModule,
  TapeEchoModule,
} from './effects.js';
import { FieldRecorderModule } from './field-recorder.js';
import { MixerModule } from './mixer.js';
import { MultiSamplerModule } from './multisampler.js';
import { OcraV11Module } from './ocra-v11.js';
import { PeerBridgeModule } from './peer-bridge.js';
import { PianoRollModule } from './piano-roll.js';
import {
  DrumSynthModule,
  FmPhaseSynthModule,
  PolySynthModule,
  SubtractiveAnalogSynthModule,
  WavetableSynthModule,
} from './synths.js';

export const requiredPeerDawModules = Object.freeze([
  'ocra',
  'sampler',
  'sequencer',
  'wiring',
  'effects',
  'master',
  'polysynth',
  'drumsynth',
  'multisampler',
  'analogsynth',
  'fmsynth',
  'wavetablesynth',
]);

export const moduleFactories = Object.freeze({
  // Timing and sequencing
  clock: () => new ClockModule(),
  metronome: () => new ClockModule({ title: 'Metronome', bpm: 120 }),
  ocra: () => new OcraV11Module(),
  sequencer: () => new BasicSequencerModule(),
  basicseq: () => new BasicSequencerModule(),
  pianoroll: () => new PianoRollModule(),
  arp: () => new ArpMidiGeneratorModule(),

  // Instruments and sample players
  synth: () => new BasicSynthModule(),
  cleansynth: () => new CleanSynthModule(),
  polysynth: () => new PolySynthModule(),
  drumsynth: () => new DrumSynthModule(),
  analogsynth: () => new SubtractiveAnalogSynthModule(),
  fmsynth: () => new FmPhaseSynthModule(),
  wavetablesynth: () => new WavetableSynthModule(),
  drumsampler: () => new DrumSamplerModule(),
  sampler: () => new CleanSamplerModule(),
  multisampler: () => new MultiSamplerModule(),

  // Wiring, effects, and master output
  wiring: () => new PeerBridgeModule({ title: 'Peer Wiring Bridge' }),
  effects: () => new DubEchoModule({ title: 'Effects Rack' }),
  master: () => new MixerModule(undefined, { id: 'master-mixer', title: 'Master Mixer' }),
  mixer: () => new MixerModule(),
  channel: () => new ChannelStripModule(),
  mixerdesk: () => new MixerDeskModule(),
  reverb: () => new ReverbModule(),
  dubecho: () => new DubEchoModule(),
  delay: () => new DelayModule(),
  tapeecho: () => new TapeEchoModule(),
  flanger: () => new FlangerModule(),
  phaser: () => new PhaserModule(),
  beatlooper: () => new BpmBeatLooperModule(),
  beatrepeat: () => new BeatRepeatModule(),
  graindelay: () => new GrainDelayModule(),
  pitchshift: () => new PitchShiftModule(),

  // Capture and peer collaboration
  field: () => new FieldRecorderModule(),
  peer: () => new PeerBridgeModule(),
});

function createClassicTwoBarDrumNotes() {
  return [
    { id: 'kick-1', beat: 0, note: 'C1', velocity: 1, duration: 0.08 },
    { id: 'snare-1', beat: 2, note: 'D1', velocity: 0.92, duration: 0.08 },
    { id: 'kick-2', beat: 4, note: 'C1', velocity: 1, duration: 0.08 },
    { id: 'kick-3', beat: 5, note: 'C1', velocity: 0.88, duration: 0.08 },
    { id: 'snare-2', beat: 6, note: 'D1', velocity: 0.92, duration: 0.08 },
    ...Array.from({ length: 16 }, (_, index) => ({
      id: `hat-${index + 1}`,
      beat: index * 0.5,
      note: 'F#1',
      velocity: index % 2 === 0 ? 0.62 : 0.42,
      duration: 0.05,
    })),
  ];
}

export function createDefaultPeerDawRig(runtime) {
  return {
    master: new MixerModule(runtime, { id: 'main-mixer', title: 'Master Mixer' }),
    clock: new ClockModule({ id: 'main-clock', title: 'Transport Clock' }),
    ocra: new OcraV11Module({ id: 'main-ocra', title: 'OCRA V11 Grid' }),
    synth: new CleanSynthModule({ id: 'main-synth', title: 'Main Synth' }),
    sampler: new CleanSamplerModule({ id: 'main-sampler', title: 'Sampler' }),
    drumSampler: new DrumSamplerModule({
      id: 'default-drum-sampler',
      title: 'Default Drum Sampler',
      swing: 'swing60',
      swingResolution: '1/8',
    }),
    drumPianoRoll: new PianoRollModule({
      id: 'default-drum-roll',
      title: 'Default 2-Bar Drum Piano Roll',
      lengthBeats: 8,
      stepResolutionBeats: 0.25,
      swing: { amount: 'swing60', resolution: '1/8' },
      notes: createClassicTwoBarDrumNotes(),
    }),
    field: new FieldRecorderModule({ id: 'field-recorder', title: 'Field Recorder' }),
    peer: new PeerBridgeModule({ id: 'peer-bridge', title: 'Peer Bridge' }),
  };
}
