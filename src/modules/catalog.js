// V11 Peer DAW/src/modules/catalog.js
// Canonical consolidated module catalog for the V11 peer DAW.

import { ArpMidiGeneratorModule, BasicSequencerModule } from './advanced-sequencer.js';
import { BasicSynthModule } from './basic-synth.js';
import { ChannelStripModule, MixerDeskModule } from './channel-strip.js';
import { CleanSamplerModule } from './clean-sampler.js';
import { CleanSynthModule } from './clean-synth.js';
import { ClockModule } from './clock.js';
import {
  BpmBeatLooperModule,
  DubEchoModule,
  FlangerModule,
  PhaserModule,
  ReverbModule,
  TapeEchoModule,
} from './effects.js';
import { FieldRecorderModule } from './field-recorder.js';
import { MixerModule } from './mixer.js';
import { MultiSamplerModule } from './multisampler.js';
import { OcraV11Module } from './ocra-v11.js';
import { PeerBridgeModule } from './peer-bridge.js';
import { PianoRollModule } from './piano-roll.js';
import { DrumSynthModule, PolySynthModule } from './synths.js';

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
  tapeecho: () => new TapeEchoModule(),
  flanger: () => new FlangerModule(),
  phaser: () => new PhaserModule(),
  beatlooper: () => new BpmBeatLooperModule(),

  // Capture and peer collaboration
  field: () => new FieldRecorderModule(),
  peer: () => new PeerBridgeModule(),
});

export function createDefaultPeerDawRig(runtime) {
  return {
    master: new MixerModule(runtime, { id: 'main-mixer', title: 'Master Mixer' }),
    clock: new ClockModule({ id: 'main-clock', title: 'Transport Clock' }),
    ocra: new OcraV11Module({ id: 'main-ocra', title: 'OCRA V11 Grid' }),
    synth: new CleanSynthModule({ id: 'main-synth', title: 'Main Synth' }),
    sampler: new CleanSamplerModule({ id: 'main-sampler', title: 'Sampler' }),
    field: new FieldRecorderModule({ id: 'field-recorder', title: 'Field Recorder' }),
    peer: new PeerBridgeModule({ id: 'peer-bridge', title: 'Peer Bridge' }),
  };
}
