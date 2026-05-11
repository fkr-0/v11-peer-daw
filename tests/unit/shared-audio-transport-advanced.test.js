import { describe, expect, test } from '@jest/globals';
import {
  OverflowPolicy,
  SharedAudioTransport,
  WasmRingBufferView,
  WorkletPullScheduler,
  WorkerDecodePipeline,
} from '../../src/core/dsp/shared-audio-transport.js';

describe('optimized shared audio transport', () => {
  test('commits batched vector writes atomically and stores frames interleaved', () => {
    const commits = [];
    const transport = SharedAudioTransport.create({
      frameCapacity: 4,
      channels: 2,
      atomics: {
        load: Atomics.load,
        add: (state, slot, value) => {
          commits.push({ slot, value });
          return Atomics.add(state, slot, value);
        },
        store: Atomics.store,
        sub: Atomics.sub,
      },
    });

    const written = transport.writeFrames([
      Float32Array.from([1, 2, 3]),
      Float32Array.from([10, 20, 30]),
    ]);

    expect(written).toBe(3);
    expect(Array.from(transport.samples.slice(0, 6))).toEqual([1, 10, 2, 20, 3, 30]);
    expect(commits).toEqual([{ slot: SharedAudioTransport.AVAILABLE_FRAMES, value: 3 }]);
  });

  test('applies wait-free drop-oldest overflow without blocking producer writes', () => {
    const transport = SharedAudioTransport.create({
      frameCapacity: 3,
      channels: 1,
      overflowPolicy: OverflowPolicy.DROP_OLDEST,
    });

    expect(transport.writeInterleaved(Float32Array.from([1, 2, 3]))).toBe(3);
    expect(transport.writeInterleaved(Float32Array.from([4, 5]))).toBe(2);

    expect(Array.from(transport.readInterleaved(3))).toEqual([3, 4, 5]);
  });

  test('worker decode pipeline writes decoded chunks into producer endpoint', async () => {
    const transport = SharedAudioTransport.create({ frameCapacity: 8, channels: 1 });
    const pipeline = new WorkerDecodePipeline({
      producer: transport.producer(),
      decode: async () => [Float32Array.from([0.1, 0.2, 0.3, 0.4])],
      chunkFrames: 2,
    });

    const result = await pipeline.decodeAndStream(new ArrayBuffer(4));

    expect(result.framesWritten).toBe(4);
    const values = Array.from(transport.consumer().readInterleaved(4));
    expect(values[0]).toBeCloseTo(0.1);
    expect(values[1]).toBeCloseTo(0.2);
    expect(values[2]).toBeCloseTo(0.3);
    expect(values[3]).toBeCloseTo(0.4);
  });

  test('worklet pull scheduler fills outputs from shared consumer and zero-fills underruns', () => {
    const transport = SharedAudioTransport.create({ frameCapacity: 4, channels: 2 });
    transport.producer().writeFrames([
      Float32Array.from([1, 2]),
      Float32Array.from([10, 20]),
    ]);
    const scheduler = new WorkletPullScheduler({ consumer: transport.consumer(), channels: 2 });
    const outputs = [new Float32Array(4), new Float32Array(4)];

    const pulled = scheduler.pull(outputs, 4);

    expect(pulled).toBe(2);
    expect(Array.from(outputs[0])).toEqual([1, 2, 0, 0]);
    expect(Array.from(outputs[1])).toEqual([10, 20, 0, 0]);
  });

  test('WASM ringbuffer view exposes shared memory offsets without copying', () => {
    const transport = SharedAudioTransport.create({ frameCapacity: 16, channels: 2 });
    const view = WasmRingBufferView.fromDescriptor(transport.descriptor());

    expect(view.sampleBuffer).toBe(transport.samples.buffer);
    expect(view.stateBuffer).toBe(transport.state.buffer);
    expect(view.sampleOffsetBytes).toBe(0);
    expect(view.sampleLength).toBe(32);
  });
});
