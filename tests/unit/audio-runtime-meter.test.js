import { describe, expect, test } from '@jest/globals';
import { AudioRuntime } from '../../src/core/audio.js';
import { formatDb, formatLatency } from '../../src/ui/performance-monitor.js';

describe('AudioRuntime metering', () => {
  test('computes peak, RMS, dB and clip hold from analyser samples', () => {
    const runtime = new AudioRuntime();
    runtime.context = { state: 'running', sampleRate: 48000, baseLatency: 0.006, outputLatency: 0.012 };
    runtime.analyser = {
      fftSize: 8,
      getFloatTimeDomainData(target) {
        target.set([0, 0.25, -0.5, 0.99, -0.25, 0.5, 0, 0]);
      },
    };

    const first = runtime.getMeterSnapshot(1000);
    expect(first.state).toBe('running');
    expect(first.peak).toBeCloseTo(0.99, 5);
    expect(first.rms).toBeGreaterThan(0.1);
    expect(first.peakDb).toBeLessThan(0);
    expect(first.clipped).toBe(true);

    runtime.analyser.getFloatTimeDomainData = (target) => target.fill(0);
    const held = runtime.getMeterSnapshot(2000);
    expect(held.clipped).toBe(true);
    const released = runtime.getMeterSnapshot(2600);
    expect(released.clipped).toBe(false);
  });

  test('reports engine diagnostics and clamps master gain', () => {
    const writes = [];
    const runtime = new AudioRuntime();
    runtime.context = {
      state: 'running',
      currentTime: 4,
      sampleRate: 44100,
      baseLatency: 0.004,
      outputLatency: 0.008,
    };
    runtime.master = { gain: { setTargetAtTime: (...args) => writes.push(args) } };
    runtime.analyser = { fftSize: 1024 };

    runtime.setMasterVolume(9);
    expect(writes[0]).toEqual([1.5, 4, 0.01]);
    expect(runtime.getPerformanceSnapshot()).toEqual({
      state: 'running',
      sampleRate: 44100,
      baseLatency: 0.004,
      outputLatency: 0.008,
      analyserSize: 1024,
    });
  });

  test('formats offline and active telemetry consistently', () => {
    expect(formatDb(-12.345)).toBe('-12.3 dB');
    expect(formatDb(-Infinity)).toBe('−∞ dB');
    expect(formatLatency(0.0045)).toBe('4.5 ms');
    expect(formatLatency(0.024)).toBe('24 ms');
    expect(formatLatency(0)).toBe('n/a');
  });
});
