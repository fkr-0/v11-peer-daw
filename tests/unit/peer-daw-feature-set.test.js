// V11 Peer DAW/tests/unit/peer-daw-feature-set.test.js
// Consolidated peer DAW feature-set tests.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { moduleFactories, requiredPeerDawModules } from '../../src/modules/catalog.js';
import { CleanSamplerModule } from '../../src/modules/clean-sampler.js';
import { MultiSamplerModule } from '../../src/modules/multisampler.js';
import {
  DrumSynthModule,
  FmPhaseSynthModule,
  PolySynthModule,
  SubtractiveAnalogSynthModule,
  WavetableSynthModule,
} from '../../src/modules/synths.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(value, when) {
    this.value = value;
    this.events.push(['setValueAtTime', value, when]);
  }
  exponentialRampToValueAtTime(value, when) {
    this.value = value;
    this.events.push(['exponentialRampToValueAtTime', value, when]);
  }
  setTargetAtTime(value, when, constant) {
    this.value = value;
    this.events.push(['setTargetAtTime', value, when, constant]);
  }
  cancelScheduledValues(when) {
    this.events.push(['cancelScheduledValues', when]);
  }
}

class FakeNode {
  constructor(type) {
    this.kind = type;
    this.type = type;
    this.connections = [];
    this.started = [];
    this.stopped = [];
  }
  connect(destination) {
    this.connections.push(destination);
  }
  disconnect() {
    this.connections = [];
  }
  start(...args) {
    this.started.push(args);
  }
  stop(...args) {
    this.stopped.push(args);
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 1;
    this.created = [];
  }
  createGain() {
    const node = new FakeNode('gain');
    node.gain = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeNode('oscillator');
    node.frequency = new FakeAudioParam(440);
    node.detune = new FakeAudioParam(0);
    node.periodicWaves = [];
    node.setPeriodicWave = (wave) => node.periodicWaves.push(wave);
    this.created.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeNode('biquad');
    node.frequency = new FakeAudioParam(1000);
    node.Q = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeNode('bufferSource');
    node.playbackRate = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createWaveShaper() {
    const node = new FakeNode('waveShaper');
    node.curve = null;
    this.created.push(node);
    return node;
  }
  createPeriodicWave(real, imag) {
    const wave = { real, imag };
    this.created.push({ kind: 'periodicWave', real, imag });
    return wave;
  }
}

function fakeBuffer(duration = 2, length = 96) {
  return {
    duration,
    length,
    getChannelData() {
      return Float32Array.from({ length }, (_, index) => Math.sin(index / 4));
    },
  };
}

describe('consolidated V11 peer DAW catalog', () => {
  test('exposes one canonical factory catalog for required DAW modules', () => {
    expect(requiredPeerDawModules).toEqual(
      expect.arrayContaining([
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
      ])
    );

    for (const key of requiredPeerDawModules) {
      expect(typeof moduleFactories[key]).toBe('function');
      const module = moduleFactories[key]();
      expect(module.id).toBeTruthy();
      expect(module.title).toBeTruthy();
      expect(Array.isArray(module.inputs)).toBe(true);
      expect(Array.isArray(module.outputs)).toBe(true);
    }
  });

  test('module bay exposes the required feature-set modules to users', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    for (const key of requiredPeerDawModules) {
      expect(html).toContain(`value="${key}"`);
    }
  });

  test('peer session panel exposes sub-lobby multiplayer controls', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('id="subLobbyStatus"');
    expect(html).toContain('id="btnHostSubLobby"');
    expect(html).toContain('id="btnNewSubLobby"');
    expect(html).toContain('id="btnCarrySubLobby"');
    expect(html).toContain('id="blockIncomingJoin"');
    expect(html).toContain('id="subLobbyPeerList"');
  });

  test('project level exposes missing-sample and sample-library panels', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('id="missingSampleSlots"');
    expect(html).toContain('id="sampleLibraryTree"');
    expect(html).toContain('id="sampleLibraryImportFile"');
    expect(html).toContain('id="sampleLibraryUploadFile"');
    expect(html).toContain('id="btnExportSampleLibrary"');
    expect(html).toContain('id="sampleLibraryJson"');
  });

  test('workspace exposes a first-class sample library matrix view', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

    expect(html).toContain('data-workspace-view="samples"');
    expect(html).toContain('>Samples<');
    expect(app).toContain('renderSampleLibraryView');
    expect(app).toContain('detectProjectSampleSlots');
    expect(app).toContain('renderSampleLibraryMatrixHtml');
    expect(app).toContain('selectedSampleId');
    expect(app).toContain('assignSelectedSampleToSlot');
  });

  test('arrangement design surface exposes automation, clips, arrangement, and composed preset controls', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('id="automationOperatorPanel"');
    expect(html).toContain('id="clipSessionPanel"');
    expect(html).toContain('id="arrangementTimelinePanel"');
    expect(html).toContain('id="composedSoundscapePresetJson"');
    expect(html).toContain('id="btnExportComposedSoundscapes"');
  });

  test('clip rows expose module, chain, and direct editor navigation affordances', () => {
    const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

    expect(app).toContain('data-clip-slot-row=');
    expect(app).toContain('Module:');
    expect(app).toContain('Chain:');
    expect(app).toContain('data-workspace-view-target="module"');
    expect(app).toContain('EDIT SAMPLES');
    expect(app).toContain('OPEN PADS');
    expect(app).toContain('View Chain');
    expect(app).toContain('data-chain-module-id');
  });

  test('signal flow workspace is promoted for module-chain discovery', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

    expect(html).toContain('Signal Flow');
    expect(app).toContain('signal-flow-overview-card');
    expect(app).toContain('Inspect Signal Flow');
    expect(app).toContain('selectedChainId');
  });

  test('module cards expose chain badges and selected-chain affordances', () => {
    const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

    expect(app).toContain('module-chain-badge');
    expect(app).toContain('data-chain-action="view-chain"');
    expect(app).toContain('selected-chain-module');
  });

  test('chain cards expose source, processor mixer, output, and edit hints', () => {
    const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

    expect(app).toContain('data-chain-card=');
    expect(app).toContain('Source:');
    expect(app).toContain('Processor/Mixer:');
    expect(app).toContain('Output:');
    expect(app).toContain('chain-edit-hint');
  });
});

describe('synth modules', () => {
  test('poly synth keeps independent voices and releases the requested note', async () => {
    const ctx = new FakeAudioContext();
    const synth = new PolySynthModule({ id: 'poly-test' });
    await synth.start(ctx);

    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C4', velocity: 0.5 });
    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'E4', velocity: 0.7 });

    expect(synth.voices.size).toBe(2);
    expect(ctx.created.filter((node) => node.kind === 'oscillator')).toHaveLength(4);

    synth.receive({ kind: PortType.MIDI, type: 'note-off', note: 'C4' });

    expect(synth.voices.has('C4')).toBe(false);
    expect(synth.voices.has('E4')).toBe(true);
  });

  test('drum synth maps notes to percussive voices', async () => {
    const ctx = new FakeAudioContext();
    const drum = new DrumSynthModule({ id: 'drum-test' });
    await drum.start(ctx);

    drum.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C1', velocity: 0.9 });
    drum.receive({ kind: PortType.MIDI, type: 'note-on', note: 'D1', velocity: 0.6 });

    expect(drum.lastHits.map((hit) => hit.voice)).toEqual(['kick', 'snare']);
    expect(ctx.created.some((node) => node.kind === 'oscillator')).toBe(true);
    expect(ctx.created.some((node) => node.kind === 'biquad')).toBe(true);
  });

  test('analog subtractive synth exposes oscillator mixer, filter, envelope, and drive', async () => {
    const ctx = new FakeAudioContext();
    const synth = new SubtractiveAnalogSynthModule({
      id: 'analog-test',
      cutoff: 1400,
      resonance: 8,
    });
    await synth.start(ctx);

    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'A4', velocity: 0.8 });

    expect(synth.voices.size).toBe(1);
    expect(synth.filter.type).toBe('lowpass');
    expect(synth.filter.frequency.value).toBe(1400);
    expect(synth.filter.Q.value).toBe(8);
    expect(ctx.created.filter((node) => node.kind === 'oscillator')).toHaveLength(3);
    expect(ctx.created.some((node) => node.kind === 'waveShaper')).toBe(true);
    expect(synth.serialize()).toEqual(
      expect.objectContaining({
        moduleType: 'analogsynth',
        oscillatorMix: expect.objectContaining({ saw: 0.65, square: 0.35, sub: 0.22 }),
        cutoff: 1400,
        resonance: 8,
      })
    );
  });

  test('FM/phase modulation synth connects modulator depth to carrier frequency and serializes ratios', async () => {
    const ctx = new FakeAudioContext();
    const synth = new FmPhaseSynthModule({
      id: 'fm-test',
      carrierRatio: 1,
      modulatorRatio: 2,
      modulationIndex: 4,
    });
    await synth.start(ctx);

    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C4', velocity: 0.6 });

    const oscillators = ctx.created.filter((node) => node.kind === 'oscillator');
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0].frequency.value).toBeCloseTo(261.625, 2);
    expect(oscillators[1].frequency.value).toBeCloseTo(523.25, 1);
    expect(synth.voices.get('C4').modDepth.connections).toContain(oscillators[0].frequency);
    expect(synth.serialize()).toEqual(
      expect.objectContaining({
        moduleType: 'fmsynth',
        carrierRatio: 1,
        modulatorRatio: 2,
        modulationIndex: 4,
        modulationMode: 'frequency',
      })
    );
  });

  test('wavetable synth builds periodic waves, morphs tables, and serializes table state', async () => {
    const ctx = new FakeAudioContext();
    const synth = new WavetableSynthModule({
      id: 'wavetable-test',
      wavetable: 'bright',
      morph: 0.75,
    });
    await synth.start(ctx);

    synth.receive({ kind: PortType.MIDI, type: 'note-on', note: 'G4', velocity: 0.7 });

    const oscillator = ctx.created.find((node) => node.kind === 'oscillator');
    expect(oscillator.periodicWaves).toHaveLength(1);
    expect(ctx.created.some((node) => node.kind === 'periodicWave')).toBe(true);
    expect(synth.serialize()).toEqual(
      expect.objectContaining({
        moduleType: 'wavetablesynth',
        wavetable: 'bright',
        morph: 0.75,
        tableSize: expect.any(Number),
      })
    );
  });
});

describe('clean sampler metadata tools', () => {
  test('serializes metadata, BPM, cues, generated beat cues, and emits sync-to-library', async () => {
    const sampler = new CleanSamplerModule({ id: 'sampler-meta', fileName: 'loop.wav' });
    const events = [];
    sampler.addEventListener('sample-library-sync', (event) => events.push(event.detail));

    sampler.setSampleMetadata({
      sampleLengthMs: 4000,
      type: 'audio/wav',
      creator: 'Ada',
      instrument: 'drums',
      songTitle: 'Loop Lab',
      tags: ['motown', 'drums'],
    });
    sampler.setBpm(120);
    sampler.addCue({ startMs: 500, name: 'drop' });
    sampler.generateInBeatCues({ startMs: 0, bpm: 120, beats: 4, upbeatMs: 25 });
    sampler.syncMetadataToLibrary();

    expect(sampler.serialize().sampleMetadata).toEqual(
      expect.objectContaining({
        filename: 'loop.wav',
        sampleLengthMs: 4000,
        type: 'audio/wav',
        creator: 'Ada',
        instrument: 'drums',
        songTitle: 'Loop Lab',
        tags: ['motown', 'drums'],
        bpm: 120,
      })
    );
    expect(sampler.serialize().sampleMetadata.cues).toEqual(
      expect.arrayContaining([
        { startMs: 500, name: 'drop' },
        { startMs: 0, bpm: 120, upbeatMs: 25, name: 'beat 1' },
      ])
    );
    expect(events[0].metadata.filename).toBe('loop.wav');
    expect(events[0].moduleId).toBe('sampler-meta');
  });

  test('hydrates sampler metadata and derives BPM from tap and interval helpers', () => {
    const sampler = new CleanSamplerModule({ id: 'sampler-hydrate' });

    sampler.hydrate({
      fileName: 'hydrated.wav',
      sampleMetadata: {
        filename: 'hydrated.wav',
        sampleLengthMs: 2000,
        cues: [{ startMs: 100, name: 'cue' }],
      },
    });
    sampler.setBpmFromTaps([0, 500, 1000]);
    expect(sampler.sampleMetadata.bpm).toBe(120);
    sampler.setBpmFromInterval({ startMs: 0, endMs: 4000, bars: 2 });
    expect(sampler.sampleMetadata.bpm).toBe(120);
    expect(sampler.serialize().sampleMetadata.cues).toContainEqual({ startMs: 100, name: 'cue' });
  });
});

describe('multisampler module', () => {
  test('maps multiple zones, slices playback, and serializes sample layout', async () => {
    const ctx = new FakeAudioContext();
    const sampler = new MultiSamplerModule({ id: 'multi-test', sliceCount: 4 });
    await sampler.start(ctx);

    sampler.addSampleZone({
      name: 'bass.wav',
      rootNote: 'C2',
      minNote: 'C1',
      maxNote: 'B2',
      buffer: fakeBuffer(4),
    });
    sampler.addSampleZone({
      name: 'lead.wav',
      rootNote: 'C5',
      minNote: 'C3',
      maxNote: 'C7',
      buffer: fakeBuffer(8),
    });

    sampler.receive({ kind: PortType.MIDI, type: 'note-on', note: 'C5', velocity: 0.8, slice: 2 });

    const source = ctx.created.find((node) => node.kind === 'bufferSource');
    expect(source.playbackRate.value).toBeCloseTo(1);
    expect(source.started[0]).toEqual([1.015, 4, 1.96]);
    expect(sampler.serialize().zones).toEqual([
      { name: 'bass.wav', rootNote: 'C2', minNote: 'C1', maxNote: 'B2' },
      { name: 'lead.wav', rootNote: 'C5', minNote: 'C3', maxNote: 'C7' },
    ]);
  });
});
