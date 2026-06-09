// V11 Peer DAW/tests/unit/automation-clips-arrangement.test.js
// Core models for automation operators, clips/session launch, and arrangement playback.

import { describe, expect, test } from '@jest/globals';
import {
  Arrangement,
  AutomationClip,
  AutomationLane,
  AutomationOperator,
  Clip,
  ClipSlot,
  createParameterAutomationPacket,
  quantizeBeat,
} from '../../src/core/clips-arrangement.js';
import { PortType } from '../../src/core/contracts.js';

describe('automation operators and lanes', () => {
  test('automation lane evaluates stepped, linear, and LFO operators over clip-local beats', () => {
    const lane = new AutomationLane({
      targetModuleId: 'filter-1',
      targetParam: 'cutoff',
      defaultValue: 500,
      operators: [
        new AutomationOperator({ type: 'linear', startBeat: 0, endBeat: 4, from: 500, to: 2500 }),
        new AutomationOperator({ type: 'step', startBeat: 4, value: 1200 }),
      ],
    });

    expect(lane.valueAt(0)).toBe(500);
    expect(lane.valueAt(2)).toBe(1500);
    expect(lane.valueAt(4.25)).toBe(1200);

    const lfo = new AutomationLane({
      targetModuleId: 'phaser-1',
      targetParam: 'rate',
      defaultValue: 0.5,
      operators: [
        new AutomationOperator({
          type: 'lfo',
          startBeat: 0,
          endBeat: 4,
          min: 0.1,
          max: 1.1,
          cycles: 1,
        }),
      ],
    });

    expect(lfo.valueAt(0)).toBeCloseTo(0.6, 5);
    expect(lfo.valueAt(1)).toBeCloseTo(1.1, 5);
  });

  test('automation clip emits control packets for all lanes at a global transport beat', () => {
    const clip = new AutomationClip({
      id: 'automation-a',
      lengthBars: 2,
      beatsPerBar: 4,
      lanes: [
        {
          targetModuleId: 'delay-1',
          targetParam: 'feedback',
          defaultValue: 0.2,
          operators: [{ type: 'linear', startBeat: 0, endBeat: 8, from: 0.2, to: 0.8 }],
        },
      ],
    });

    expect(clip.lengthBeats).toBe(8);
    expect(clip.controlPacketsAt(12)).toEqual([
      createParameterAutomationPacket({
        targetModuleId: 'delay-1',
        targetParam: 'feedback',
        value: 0.5,
        beat: 12,
      }),
    ]);
  });
});

describe('clips and session launch', () => {
  test('clip holds MIDI notes and automation data inside a bar length', () => {
    const clip = new Clip({
      id: 'clip-a',
      name: 'Bass Loop',
      lengthBars: 1,
      channelId: 'bass',
      midi: [{ beat: 0, note: 'C2', velocity: 0.8, duration: 1 }],
      automation: [
        {
          targetModuleId: 'bass-filter',
          targetParam: 'cutoff',
          operators: [{ type: 'step', startBeat: 0, value: 900 }],
        },
      ],
    });

    expect(clip.lengthBeats).toBe(4);
    expect(clip.eventsAt(0)).toEqual([
      {
        kind: PortType.MIDI,
        type: 'note-on',
        note: 'C2',
        velocity: 0.8,
        beat: 0,
        channelId: 'bass',
        duration: 1,
      },
      {
        kind: PortType.CONTROL,
        type: 'param',
        target: 'cutoff',
        value: 900,
        targetModuleId: 'bass-filter',
        beat: 0,
      },
    ]);
  });

  test('clip slot launches and stops quantized to the global clock', () => {
    const slot = new ClipSlot({ channelId: 'drone', quantizationBeats: 4 });
    const clip = new Clip({ id: 'drone-a', lengthBars: 2, channelId: 'drone' });

    slot.queueLaunch(clip, 5.2);
    expect(slot.launchBeat).toBe(8);
    expect(slot.activeClipAt(7.99)).toBeNull();
    expect(slot.activeClipAt(8)).toBe(clip);

    slot.queueStop(9.1);
    expect(slot.stopBeat).toBe(12);
    expect(slot.activeClipAt(11.99)).toBe(clip);
    expect(slot.activeClipAt(12)).toBeNull();
  });

  test('clip slot emits no packets at or after queued quantized stop beat', () => {
    const clip = new Clip({
      id: 'stoppable',
      name: 'Stoppable Clip',
      channelId: 'drums-1',
      lengthBars: 4,
      beatsPerBar: 4,
      midi: [
        { beat: 0, note: 'C4', velocity: 0.9, duration: 1 },
        { beat: 8, note: 'D4', velocity: 0.7, duration: 1 },
      ],
    });
    const slot = new ClipSlot({ channelId: 'drums-1', quantizationBeats: 4 });

    expect(slot.queueLaunch(clip, 0)).toBe(0);
    expect(slot.eventsAt(0)).toHaveLength(1);
    expect(slot.queueStop(5)).toBe(8);

    expect(slot.activeClipAt(7.999)).toBe(clip);
    expect(slot.activeClipAt(8)).toBeNull();
    expect(slot.eventsAt(8)).toEqual([]);
    expect(slot.eventsAt(12)).toEqual([]);
  });

  test('quantization helper snaps up to the next musical boundary', () => {
    expect(quantizeBeat(0, 4)).toBe(0);
    expect(quantizeBeat(0.01, 4)).toBe(4);
    expect(quantizeBeat(7.999, 4)).toBe(8);
  });
});

describe('arrangement timeline', () => {
  test('arrangement places clips on a global timeline and returns active events for playback', () => {
    const clip = new Clip({
      id: 'clip-atmo',
      name: 'Atmosphere',
      channelId: 'atmo',
      lengthBars: 2,
      midi: [{ beat: 1, note: 'A2', velocity: 0.5, duration: 2 }],
      automation: [
        {
          targetModuleId: 'reverb-1',
          targetParam: 'wet',
          operators: [{ type: 'linear', startBeat: 0, endBeat: 8, from: 0.2, to: 0.9 }],
        },
      ],
    });
    const arrangement = new Arrangement({ loopStartBeat: 16, loopEndBeat: 24 });

    arrangement.placeClip({ clip, startBeat: 16, trackId: 'atmo-track' });

    expect(arrangement.activeClipsAt(17)).toEqual([
      expect.objectContaining({ clip, localBeat: 1 }),
    ]);
    expect(arrangement.eventsAt(17)).toEqual([
      {
        kind: PortType.MIDI,
        type: 'note-on',
        note: 'A2',
        velocity: 0.5,
        beat: 17,
        channelId: 'atmo',
        duration: 2,
      },
      expect.objectContaining({
        kind: PortType.CONTROL,
        targetModuleId: 'reverb-1',
        target: 'wet',
        beat: 17,
      }),
    ]);
    expect(arrangement.transportPositionAfter(25, { loop: true })).toBe(17);
  });
});
