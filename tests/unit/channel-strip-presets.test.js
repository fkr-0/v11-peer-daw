// V11 Peer DAW/tests/unit/channel-strip-presets.test.js
// Import/export coverage for channel strips and filter chains.

import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { ChannelStripModule } from '../../src/modules/channel-strip.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setTargetAtTime(value, when, constant) {
    this.value = value;
    this.events.push(['setTargetAtTime', value, when, constant]);
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
  }
  connect(destination) {
    this.connections.push(destination);
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 7;
    this.created = [];
  }
  createGain() {
    const node = new FakeNode('gain');
    node.gain = new FakeAudioParam(1);
    this.created.push(node);
    return node;
  }
  createStereoPanner() {
    const node = new FakeNode('stereoPanner');
    node.pan = new FakeAudioParam(0);
    this.created.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeNode('biquad');
    node.type = 'lowpass';
    node.frequency = new FakeAudioParam(350);
    node.Q = new FakeAudioParam(1);
    node.gain = new FakeAudioParam(0);
    this.created.push(node);
    return node;
  }
}

describe('channel strip filter-chain presets', () => {
  test('exports a JSON-safe channel-strip preset including ordered filter stages', () => {
    const strip = new ChannelStripModule({
      id: 'channel-a',
      title: 'Lead Bus',
      gain: 1.1,
      pan: -0.2,
      muted: true,
      filters: [
        { id: 'hp', type: 'highpass', frequency: 80, q: 0.7, gain: 0, enabled: true },
        { id: 'presence', type: 'peaking', frequency: 3500, q: 1.1, gain: 3, enabled: false },
      ],
    });

    expect(strip.exportPreset()).toEqual({
      schemaVersion: 1,
      type: 'v11.channel-strip',
      title: 'Lead Bus',
      channel: { gain: 1.1, pan: -0.2, muted: true },
      filters: [
        { id: 'hp', type: 'highpass', frequency: 80, q: 0.7, gain: 0, enabled: true },
        { id: 'presence', type: 'peaking', frequency: 3500, q: 1.1, gain: 3, enabled: false },
      ],
    });
    expect(JSON.parse(strip.exportPresetJson()).filters).toHaveLength(2);
  });

  test('imports a preset, clamps unsafe values, and updates live audio nodes', async () => {
    const ctx = new FakeAudioContext();
    const strip = new ChannelStripModule({ id: 'channel-b' });
    await strip.start(ctx);

    strip.importPreset({
      schemaVersion: 1,
      type: 'v11.channel-strip',
      title: 'Imported Bus',
      channel: { gain: 4, pan: -2, muted: false },
      filters: [
        { id: 'sub', type: 'lowshelf', frequency: 30, q: 0.4, gain: 9, enabled: true },
        { id: 'air', type: 'highshelf', frequency: 24000, q: 0.5, gain: 50, enabled: true },
      ],
    });

    expect(strip.title).toBe('Imported Bus');
    expect(strip.gainValue).toBe(1.5);
    expect(strip.panValue).toBe(-1);
    expect(strip.filters).toEqual([
      { id: 'sub', type: 'lowshelf', frequency: 30, q: 0.4, gain: 9, enabled: true },
      { id: 'air', type: 'highshelf', frequency: 20000, q: 0.5, gain: 24, enabled: true },
    ]);
    expect(strip.output.gain.value).toBe(1.5);
    expect(strip.pan.pan.value).toBe(-1);
    expect(strip.filterNodes).toHaveLength(2);
    expect(strip.filterNodes[1].frequency.value).toBe(20000);
    expect(strip.filterNodes[1].gain.value).toBe(24);
    expect(strip.input.connections[0]).toBe(strip.filterNodes[0]);
    expect(strip.filterNodes[0].connections[0]).toBe(strip.filterNodes[1]);
    expect(strip.filterNodes[1].connections[0]).toBe(strip.pan);
  });

  test('imports preset JSON and handles control packets for channel and filter params', async () => {
    const ctx = new FakeAudioContext();
    const strip = new ChannelStripModule({ id: 'channel-c' });
    await strip.start(ctx);

    strip.importPresetJson(
      JSON.stringify({
        schemaVersion: 1,
        type: 'v11.channel-strip',
        title: 'JSON Bus',
        channel: { gain: 0.7, pan: 0.4, muted: false },
        filters: [{ id: 'tone', type: 'bandpass', frequency: 1200, q: 2, gain: 0, enabled: true }],
      })
    );
    strip.receive({
      kind: PortType.CONTROL,
      type: 'param',
      target: 'filter.frequency',
      filterId: 'tone',
      value: 800,
    });
    strip.receive({ kind: PortType.CONTROL, type: 'param', target: 'gain', value: 0.5 });

    expect(strip.gainValue).toBe(0.5);
    expect(strip.filters[0].frequency).toBe(800);
    expect(strip.filterNodes[0].frequency.value).toBe(800);
    expect(strip.exportPreset()).toEqual(
      expect.objectContaining({ schemaVersion: 1, type: 'v11.channel-strip', title: 'JSON Bus' })
    );
    expect(strip.serialize()).toEqual(
      expect.objectContaining({
        id: 'channel-c',
        kind: 'mixer-channel',
        schemaVersion: 1,
        type: 'v11.channel-strip',
        title: 'JSON Bus',
      })
    );
  });
});
