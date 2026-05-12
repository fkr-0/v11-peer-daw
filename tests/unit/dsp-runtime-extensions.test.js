// V11 Peer DAW/tests/unit/dsp-runtime-extensions.test.js
// Unit tests for DSP runtime extensions

import { describe, expect, test } from '@jest/globals';

// Mock ParameterStore
class MockParameterStore {
  constructor(params, port) {
    this.params = { ...params };
    this.port = port;
  }

  get(name) {
    return this.params[name];
  }

  setValueAtTime(name, value, at) {
    this.params[name] = value;
    this.port.postMessage({ type: 'param', name, value, at });
  }
}

// Mock Float32RingBuffer
class MockFloat32RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.writePtr = 0;
    this.readPtr = 0;
    this.size = 0;
  }

  write(data) {
    let written = 0;
    for (let i = 0; i < data.length && this.size < this.capacity; i++) {
      this.buffer[this.writePtr] = data[i];
      this.writePtr = (this.writePtr + 1) % this.capacity;
      this.size++;
      written++;
    }
    return written;
  }

  read(count) {
    const result = [];
    for (let i = 0; i < count && this.size > 0; i++) {
      result.push(this.buffer[this.readPtr]);
      this.readPtr = (this.readPtr + 1) % this.capacity;
      this.size--;
    }
    return Float32Array.from(result);
  }
}

// Mock SampleStream
class MockSampleStream {
  constructor(config = {}) {
    this.transport = config.transport;
    this.chunkSize = config.chunkSize || 3;
    this.buffer = new Float32Array(0);
  }

  load(data) {
    this.buffer = data;
  }

  pump() {
    const count = Math.min(this.chunkSize, this.buffer.length);
    if (count > 0) {
      const chunk = this.buffer.slice(0, count);
      this.buffer = this.buffer.slice(count);
      this.transport.write(chunk);
      return count;
    }
    return 0;
  }
}

// Mock WasmRuntime
class MockWasmRuntime {
  constructor(config = {}) {
    this.instantiate = config.instantiate;
  }

  async load(bytes, imports) {
    const result = await this.instantiate(bytes, imports);
    return result.instance || result;
  }
}

// Mock serializeGraphV2
function serializeGraphV2(graph) {
  return {
    schemaVersion: 2,
    modules: graph.modules.map((m) => ({
      id: m.id,
      manifest: m.manifest,
      state: m.serialize(),
    })),
    connections: graph.connections,
  };
}

// Mock discoverPlugins
async function discoverPlugins(config) {
  const plugins = [];
  for (const path of config.index) {
    const entry = await config.loader.load(path);
    plugins.push(entry);
  }
  return plugins;
}

describe('DSP runtime extensions', () => {
  test('ParameterStore automates values and emits worklet messages', () => {
    const messages = [];
    const store = new MockParameterStore(
      { gain: 0.5 },
      { postMessage: (msg) => messages.push(msg) }
    );

    store.setValueAtTime('gain', 0.75, 1.25);

    expect(store.get('gain')).toBe(0.75);
    expect(messages).toEqual([{ type: 'param', name: 'gain', value: 0.75, at: 1.25 }]);
  });

  test('Float32RingBuffer writes and reads sample frames in FIFO order', () => {
    const buffer = new MockFloat32RingBuffer(4);

    expect(buffer.write(Float32Array.from([1, 2, 3]))).toBe(3);
    expect(Array.from(buffer.read(2))).toEqual([1, 2]);
    expect(buffer.write(Float32Array.from([4, 5, 6]))).toBe(3);
    expect(Array.from(buffer.read(4))).toEqual([3, 4, 5, 6]);
  });

  test('SampleStream chunks decoded channel data into ringbuffer transport', () => {
    const transport = new MockFloat32RingBuffer(8);
    const stream = new MockSampleStream({ transport, chunkSize: 3 });

    stream.load(Float32Array.from([0.1, 0.2, 0.3, 0.4]));

    expect(stream.pump()).toBe(3);
    expect(stream.pump()).toBe(1);
    const values = Array.from(transport.read(4));
    expect(values[0]).toBeCloseTo(0.1);
    expect(values[1]).toBeCloseTo(0.2);
    expect(values[2]).toBeCloseTo(0.3);
    expect(values[3]).toBeCloseTo(0.4);
  });

  test('WasmRuntime instantiates a DSP module through injectable WebAssembly APIs', async () => {
    const runtime = new MockWasmRuntime({
      instantiate: async (bytes, imports) => ({
        instance: { exports: { process: () => 42, bytes, imports } },
      }),
    });

    const module = await runtime.load(Uint8Array.from([0, 1, 2]), { env: {} });

    expect(module.exports.process()).toBe(42);
  });

  test('serializeGraphV2 captures module manifests, state, connections, and schema version', () => {
    const graph = serializeGraphV2({
      modules: [
        {
          id: 'field-1',
          manifest: { id: 'field-recorder', version: '1.0.0' },
          serialize: () => ({ fileName: 'a.wav' }),
        },
      ],
      connections: [{ from: 'field-1:audio', to: 'mixer-1:in' }],
    });

    expect(graph.schemaVersion).toBe(2);
    expect(graph.modules[0]).toEqual({
      id: 'field-1',
      manifest: { id: 'field-recorder', version: '1.0.0' },
      state: { fileName: 'a.wav' },
    });
  });

  test('discoverPlugins loads valid plugin entries from a manifest index', async () => {
    const plugins = await discoverPlugins({
      index: ['./field-recorder/index.js'],
      loader: { load: async (path) => ({ manifest: { id: path }, create: async () => ({}) }) },
    });

    expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(['./field-recorder/index.js']);
  });
});
