import { describe, expect, test } from '@jest/globals';
import {
  createProjectSource,
  serializeClipState,
  serializeMixerState,
  serializeRig,
} from '../../src/core/project-state.js';

describe('project state serialization helpers', () => {
  const clip = { serialize: () => ({ name: 'clip-a', midi: [{ note: 60 }] }) };
  const modules = [
    {
      id: 'sampler-a',
      kind: 'sampler',
      title: 'Sampler A',
      serialize: () => ({
        id: 'sampler-a',
        kind: 'sampler',
        title: 'Sampler A',
        fileName: 'a.wav',
      }),
    },
    { id: 'fallback-a', kind: 'effect', title: 'Fallback FX' },
  ];
  const routes = [{ from: { moduleId: 'sampler-a' }, to: { moduleId: 'fallback-a' } }];
  const arrangement = { serialize: () => ({ loopStartBeat: 0, loopEndBeat: 16, clips: [] }) };
  const routingGraph = {
    serialize: () => ({ nodes: [{ id: 'sampler-a' }], edges: [], chains: [] }),
  };
  const patchCanvas = { serializePositions: () => ({ 'sampler-a': { x: 12, y: 34 } }) };

  test('serializes mixer and clip state without leaking mutable references', () => {
    const mixerState = { masterVolume: 0.7, channels: { a: { gain: 0.5, pan: -0.2 } } };
    const clipSlots = [
      {
        id: 'slot-a',
        moduleId: 'sampler-a',
        name: 'Slot A',
        channelId: 'sampler-a',
        quantizationBeats: 4,
        launchBeat: 0,
        stopBeat: null,
        clip,
      },
    ];

    const mixer = serializeMixerState(mixerState);
    const clips = serializeClipState({ currentBeat: 8, clipSlots });

    expect(mixer).toEqual({ masterVolume: 0.7, channels: { a: { gain: 0.5, pan: -0.2 } } });
    expect(mixer.channels.a).not.toBe(mixerState.channels.a);
    expect(clips).toEqual({
      currentBeat: 8,
      slots: [
        {
          id: 'slot-a',
          moduleId: 'sampler-a',
          name: 'Slot A',
          channelId: 'sampler-a',
          quantizationBeats: 4,
          launchBeat: 0,
          stopBeat: null,
          clip: { name: 'clip-a', midi: [{ note: 60 }] },
        },
      ],
    });
  });

  test('creates project source and rig snapshots from explicit dependencies', () => {
    const input = {
      modules,
      routes,
      clipState: { currentBeat: 4, slots: [] },
      arrangement,
      mixerState: { masterVolume: 0.9, channels: {} },
      routingGraph,
      patchCanvas,
    };

    expect(createProjectSource(input)).toEqual({
      modules,
      routes,
      clips: { currentBeat: 4, slots: [] },
      arrangement: { loopStartBeat: 0, loopEndBeat: 16, clips: [] },
      mixer: { masterVolume: 0.9, channels: {} },
      graph: { nodes: [{ id: 'sampler-a' }], edges: [], chains: [] },
      canvasPositions: { 'sampler-a': { x: 12, y: 34 } },
    });

    expect(serializeRig(input)).toEqual({
      version: 1,
      modules: [
        { id: 'sampler-a', kind: 'sampler', title: 'Sampler A', fileName: 'a.wav' },
        { id: 'fallback-a', kind: 'effect', title: 'Fallback FX' },
      ],
      routes,
      clips: { currentBeat: 4, slots: [] },
      arrangement: { loopStartBeat: 0, loopEndBeat: 16, clips: [] },
      mixer: { masterVolume: 0.9, channels: {} },
      graph: { nodes: [{ id: 'sampler-a' }], edges: [], chains: [] },
      canvasPositions: { 'sampler-a': { x: 12, y: 34 } },
    });
  });
});
