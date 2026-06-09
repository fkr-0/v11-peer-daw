// V11 Peer DAW/tests/unit/sample-library.test.js
// Core sample-library, missing-slot, and peer-sync behavior tests.

import { describe, expect, test } from '@jest/globals';
import {
  SampleLibrary,
  SampleSyncManager,
  createCue,
  deriveBpmFromInterval,
  detectMissingSampleSlots,
  detectProjectSampleUsage,
  detectProjectSampleSlots,
  generateBeatCues,
  normalizeSampleMetadata,
  tapTempoBpm,
} from '../../src/core/sample-library.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.get(key) ?? null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

describe('sample metadata helpers', () => {
  test('normalizes mandatory and optional metadata without losing cue/slice structure', () => {
    const sample = normalizeSampleMetadata({
      filename: 'break.wav',
      sampleLengthMs: 2400,
      bitrate: 1411200,
      creator: 'Ada',
      instrument: 'drums',
      songTitle: 'Loop Lab',
      tags: ['motown', 'drums', 'motown'],
      cues: [{ startMs: 120, endMs: 600, bpm: 100, upbeatMs: 40, name: 'bar 1' }],
      slices: [{ startMs: 120, name: 'kick' }],
    });

    expect(sample).toEqual(
      expect.objectContaining({
        id: 'break.wav',
        filename: 'break.wav',
        sampleLengthMs: 2400,
        bitrate: 1411200,
        creator: 'Ada',
        instrument: 'drums',
        songTitle: 'Loop Lab',
        tags: ['motown', 'drums'],
      })
    );
    expect(sample.cues[0]).toEqual({
      startMs: 120,
      endMs: 600,
      bpm: 100,
      upbeatMs: 40,
      name: 'bar 1',
    });
    expect(sample.slices[0]).toEqual({ startMs: 120, name: 'kick' });
  });

  test('calculates BPM from taps and musical intervals', () => {
    expect(tapTempoBpm([0, 500, 1000, 1500])).toBe(120);
    expect(deriveBpmFromInterval({ startMs: 1000, endMs: 3000, bars: 1 })).toBe(120);
    expect(deriveBpmFromInterval({ startMs: 1000, endMs: 5000, bars: 2 })).toBe(120);
  });

  test('creates cues and generates in-beat cues from upbeat and BPM', () => {
    expect(createCue({ startMs: 250, bpm: 120, name: 'drop' })).toEqual({
      startMs: 250,
      bpm: 120,
      name: 'drop',
    });
    expect(generateBeatCues({ startMs: 100, bpm: 120, beats: 4, upbeatMs: 25 })).toEqual([
      { startMs: 75, bpm: 120, upbeatMs: 25, name: 'beat 1' },
      { startMs: 575, bpm: 120, upbeatMs: 25, name: 'beat 2' },
      { startMs: 1075, bpm: 120, upbeatMs: 25, name: 'beat 3' },
      { startMs: 1575, bpm: 120, upbeatMs: 25, name: 'beat 4' },
    ]);
  });
});

describe('SampleLibrary', () => {
  test('imports nested directory snapshots, exports JSON, and persists to storage', () => {
    const storage = new MemoryStorage();
    const library = new SampleLibrary({ storageKey: 'samples', storage });
    library.importSnapshot({
      root: {
        name: 'root',
        dirs: [
          {
            name: 'drums',
            samples: [
              { filename: 'kick.wav', sampleLengthMs: 500, type: 'audio/wav', tags: ['kick'] },
            ],
            dirs: [
              {
                name: 'breaks',
                samples: [{ filename: 'amen.wav', sampleLengthMs: 6200, tags: ['full-song'] }],
              },
            ],
          },
        ],
      },
    });

    expect(library.findSample('kick.wav')).toEqual(
      expect.objectContaining({
        filename: 'kick.wav',
        sampleLengthMs: 500,
        path: '/drums/kick.wav',
      })
    );
    expect(library.listSamples().map((sample) => sample.path)).toEqual([
      '/drums/kick.wav',
      '/drums/breaks/amen.wav',
    ]);

    library.save();
    const restored = new SampleLibrary({ storageKey: 'samples', storage });
    restored.load();
    expect(restored.findSample('amen.wav')).toEqual(
      expect.objectContaining({ filename: 'amen.wav', sampleLengthMs: 6200 })
    );
    expect(JSON.parse(restored.exportJson()).root.dirs[0].name).toBe('drums');
  });

  test('adds local samples, merges peer libraries, and tracks source ownership', () => {
    const library = new SampleLibrary();
    library.addSample('/local', { filename: 'flute.wav', sampleLengthMs: 1100, tags: ['flute'] });
    library.mergePeerLibrary('peer-1', {
      root: {
        name: 'root',
        dirs: [{ name: 'peer-pack', samples: [{ filename: 'vox.wav', sampleLengthMs: 900 }] }],
      },
    });

    expect(library.findSample('flute.wav').source).toBe('local');
    expect(library.findSample('vox.wav')).toEqual(
      expect.objectContaining({ source: 'peer', peerId: 'peer-1', path: '/peer-pack/vox.wav' })
    );
  });

  test('keeps same-named imported files as distinct library samples instead of overwriting', () => {
    const library = new SampleLibrary();
    library.addSample('/uploads', { filename: 'snare.wav', sampleLengthMs: 100 });
    library.addSample('/uploads', { filename: 'snare.wav', sampleLengthMs: 220 });

    const snares = library.listSamples().filter((sample) => sample.filename === 'snare.wav');

    expect(snares).toHaveLength(2);
    expect(snares.map((sample) => sample.sampleLengthMs)).toEqual([100, 220]);
    expect(new Set(snares.map((sample) => sample.id)).size).toBe(2);
  });
});

describe('project sample usage and missing sample slots', () => {
  test('lists all project-used samples with availability state', () => {
    const project = {
      modules: [
        {
          id: 'sampler-1',
          moduleType: 'sampler',
          title: 'Lead Sampler',
          fileName: 'lead.wav',
          sampleRef: 'sampler-1/sample',
        },
        {
          id: 'drums-1',
          moduleType: 'drumsampler',
          title: 'Drums',
          pads: [{ id: 'kick', name: 'kick.wav', sampleRef: 'drums-1/kick' }],
        },
      ],
      assets: [{ id: 'drums-1/kick', label: 'kick.wav' }],
    };
    const library = new SampleLibrary();
    library.addSample('/samples', {
      filename: 'lead.wav',
      sampleLengthMs: 800,
      sampleRef: 'sampler-1/sample',
    });

    expect(detectProjectSampleUsage(project, library)).toEqual([
      expect.objectContaining({
        id: 'sampler-1/sample',
        filename: 'lead.wav',
        availability: 'available',
      }),
      expect.objectContaining({
        id: 'drums-1/kick',
        filename: 'kick.wav',
        availability: 'embedded',
      }),
    ]);
  });

  test('lists every assignable project sample slot including empty drum pads and multisampler zones', () => {
    const project = {
      modules: [
        {
          id: 'sampler-1',
          moduleType: 'sampler',
          title: 'Lead Sampler',
          fileName: 'lead.wav',
          sampleRef: 'sampler-1/sample',
        },
        {
          id: 'drums-1',
          moduleType: 'drumsampler',
          title: 'Drums',
          pads: [
            { id: 'kick', name: 'kick.wav', sampleRef: 'drums-1/kick' },
            { id: 'snare', name: 'Snare' },
          ],
        },
        {
          id: 'multi-1',
          moduleType: 'multisampler',
          title: 'Multi',
          zones: [{ name: 'zone-a.wav', rootNote: 'C4', sampleRef: 'multi-1/zone-a' }],
        },
      ],
      assets: [{ id: 'drums-1/kick', label: 'kick.wav' }],
    };
    const library = new SampleLibrary();
    library.addSample('/samples', {
      filename: 'lead.wav',
      sampleLengthMs: 800,
      sampleRef: 'sampler-1/sample',
    });

    const slots = detectProjectSampleSlots(project, library);

    expect(slots.map((slot) => [slot.id, slot.slotLabel, slot.availability])).toEqual([
      ['sampler-1/sample', 'Main sample', 'available'],
      ['drums-1/kick', 'kick.wav', 'embedded'],
      ['drums-1/snare', 'Snare', 'empty'],
      ['multi-1/zone-a', 'Zone C4', 'missing'],
    ]);
    expect(slots[2]).toEqual(
      expect.objectContaining({ moduleId: 'drums-1', slotId: 'snare', filename: undefined })
    );
  });

  test('detects one card-worthy slot per unresolved project sample reference', () => {
    const project = {
      modules: [
        {
          id: 'sampler-1',
          moduleType: 'sampler',
          title: 'Lead Sampler',
          fileName: 'lead.wav',
          sampleRef: 'sampler-1/sample',
        },
        {
          id: 'drums-1',
          moduleType: 'drumsampler',
          title: 'Drums',
          pads: [
            { id: 'kick', name: 'kick.wav', sampleRef: 'drums-1/kick' },
            { id: 'snare', name: 'snare.wav' },
          ],
        },
        {
          id: 'multi-1',
          moduleType: 'multisampler',
          title: 'Multi',
          zones: [{ name: 'zone-a.wav', rootNote: 'C4', sampleRef: 'multi-1/zone-a' }],
        },
      ],
      assets: [{ id: 'drums-1/kick', label: 'kick.wav' }],
    };
    const library = new SampleLibrary();
    library.addSample('/samples', {
      filename: 'zone-a.wav',
      sampleLengthMs: 800,
      sampleRef: 'multi-1/zone-a',
    });

    const slots = detectMissingSampleSlots(project, library);

    expect(slots).toEqual([
      expect.objectContaining({
        id: 'sampler-1/sample',
        moduleId: 'sampler-1',
        moduleTitle: 'Lead Sampler',
        filename: 'lead.wav',
        fillState: 'missing',
      }),
    ]);
  });
});

describe('SampleSyncManager', () => {
  test('requests peer samples and emits monotonic progress until local completion', () => {
    const library = new SampleLibrary();
    const sent = [];
    const sync = new SampleSyncManager({
      library,
      send: (packet) => sent.push(packet),
      chunkSize: 4,
    });
    const progress = [];
    sync.on('progress', (event) => progress.push(event));

    sync.requestSample({
      slotId: 'sampler-1/sample',
      sampleRef: 'sampler-1/sample',
      filename: 'lead.wav',
      peerId: 'peer-1',
    });
    expect(sent).toEqual([
      {
        type: 'v11-daw:sample-request',
        peerId: 'peer-1',
        payload: {
          slotId: 'sampler-1/sample',
          sampleRef: 'sampler-1/sample',
          filename: 'lead.wav',
        },
      },
    ]);

    sync.receiveSampleStart({
      slotId: 'sampler-1/sample',
      sampleRef: 'sampler-1/sample',
      filename: 'lead.wav',
      totalBytes: 10,
      metadata: { filename: 'lead.wav', sampleLengthMs: 1000, type: 'audio/wav' },
    });
    sync.receiveSampleChunk({ slotId: 'sampler-1/sample', bytes: Uint8Array.from([1, 2, 3, 4]) });
    sync.receiveSampleChunk({ slotId: 'sampler-1/sample', bytes: Uint8Array.from([5, 6, 7, 8]) });
    sync.receiveSampleComplete({ slotId: 'sampler-1/sample', bytes: Uint8Array.from([9, 10]) });

    expect(progress.map((event) => event.progress)).toEqual([0, 0.4, 0.8, 1]);
    expect(library.findSample('lead.wav')).toEqual(
      expect.objectContaining({
        filename: 'lead.wav',
        sampleLengthMs: 1000,
        sampleRef: 'sampler-1/sample',
      })
    );
    expect(library.findSample('lead.wav').bytes).toEqual(
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    );
  });

  test('emits incoming requests and answers from the local library with chunked packets', () => {
    const library = new SampleLibrary();
    library.addSample('/local', {
      filename: 'lead.wav',
      sampleRef: 'sampler-1/sample',
      sampleLengthMs: 1000,
      type: 'audio/wav',
      bytes: Uint8Array.from([1, 2, 3, 4, 5]),
    });
    const sent = [];
    const requests = [];
    const sync = new SampleSyncManager({
      library,
      send: (packet) => sent.push(packet),
      chunkSize: 2,
    });
    sync.on('request', (event) => requests.push(event));

    sync.receivePacket({
      type: 'v11-daw:sample-request',
      peerId: 'peer-1',
      payload: { slotId: 'sampler-1/sample', sampleRef: 'sampler-1/sample', filename: 'lead.wav' },
    });
    expect(requests).toEqual([
      {
        peerId: 'peer-1',
        slotId: 'sampler-1/sample',
        sampleRef: 'sampler-1/sample',
        filename: 'lead.wav',
      },
    ]);

    expect(sync.answerRequest(requests[0])).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'v11-daw:sample-start',
        peerId: 'peer-1',
        payload: expect.objectContaining({
          slotId: 'sampler-1/sample',
          sampleRef: 'sampler-1/sample',
          filename: 'lead.wav',
          totalBytes: 5,
          metadata: expect.objectContaining({ sampleLengthMs: 1000, type: 'audio/wav' }),
        }),
      }),
      {
        type: 'v11-daw:sample-chunk',
        peerId: 'peer-1',
        payload: { slotId: 'sampler-1/sample', bytes: Uint8Array.from([1, 2]) },
      },
      {
        type: 'v11-daw:sample-chunk',
        peerId: 'peer-1',
        payload: { slotId: 'sampler-1/sample', bytes: Uint8Array.from([3, 4]) },
      },
      {
        type: 'v11-daw:sample-complete',
        peerId: 'peer-1',
        payload: { slotId: 'sampler-1/sample', bytes: Uint8Array.from([5]) },
      },
    ]);
  });
});
