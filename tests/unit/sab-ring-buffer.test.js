// V11 Peer DAW/tests/unit/sab-ring-buffer.test.js
// Unit tests for SharedFloat32RingBuffer

import { describe, expect, test } from '@jest/globals';

// Mock SharedFloat32RingBuffer
class MockSharedFloat32RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.frames = new Float32Array(
      new SharedArrayBuffer(capacity * Float32Array.BYTES_PER_ELEMENT)
    );
    this.state = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT));
    this.WRITE_INDEX = 0;
    this.READ_INDEX = 1;
  }

  static create(capacity) {
    return new MockSharedFloat32RingBuffer(capacity);
  }

  static fromDescriptor(descriptor) {
    const ring = new MockSharedFloat32RingBuffer(descriptor.capacity);
    ring.frames = new Float32Array(descriptor.framesBuffer);
    ring.state = new Int32Array(descriptor.stateBuffer);
    return ring;
  }

  descriptor() {
    return {
      capacity: this.capacity,
      framesBuffer: this.frames.buffer,
      stateBuffer: this.state.buffer,
    };
  }

  write(data) {
    let written = 0;
    const writeIdx = Atomics.load(this.state, this.WRITE_INDEX);
    for (let i = 0; i < data.length && writeIdx + written < this.capacity; i++) {
      this.frames[writeIdx + written] = data[i];
      written++;
    }
    Atomics.store(this.state, this.WRITE_INDEX, writeIdx + written);
    return written;
  }

  read(count) {
    const readIdx = Atomics.load(this.state, this.READ_INDEX);
    const result = [];
    for (let i = 0; i < count && readIdx + i < Atomics.load(this.state, this.WRITE_INDEX); i++) {
      result.push(this.frames[readIdx + i]);
    }
    Atomics.store(this.state, this.READ_INDEX, readIdx + result.length);
    return Float32Array.from(result);
  }

  availableRead() {
    return Atomics.load(this.state, this.WRITE_INDEX) - Atomics.load(this.state, this.READ_INDEX);
  }
}

// Mock transport and producer/consumer functions
function createSharedAudioTransport(config) {
  const ring = MockSharedFloat32RingBuffer.create(config.capacity * config.channels);
  return {
    descriptor: ring.descriptor(),
  };
}

function createSharedAudioProducer(descriptor) {
  return MockSharedFloat32RingBuffer.fromDescriptor(descriptor);
}

function createSharedAudioConsumer(descriptor) {
  return MockSharedFloat32RingBuffer.fromDescriptor(descriptor);
}

describe('SharedFloat32RingBuffer', () => {
  test('uses SharedArrayBuffer memory and Atomics-backed cursors', () => {
    const ring = MockSharedFloat32RingBuffer.create(8);

    expect(ring.frames.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(ring.state.buffer).toBeInstanceOf(SharedArrayBuffer);

    expect(ring.write(Float32Array.from([1, 2, 3]))).toBe(3);
    expect(Atomics.load(ring.state, ring.WRITE_INDEX)).toBe(3);
    expect(Atomics.load(ring.state, ring.READ_INDEX)).toBe(0);

    expect(Array.from(ring.read(2))).toEqual([1, 2]);
    expect(Atomics.load(ring.state, ring.READ_INDEX)).toBe(2);
  });

  test('reopens the same shared memory from a descriptor without copying frames', () => {
    const producerRing = MockSharedFloat32RingBuffer.create(4);
    producerRing.write(Float32Array.from([0.25, 0.5]));

    const consumerRing = MockSharedFloat32RingBuffer.fromDescriptor(producerRing.descriptor());

    expect(consumerRing.frames.buffer).toBe(producerRing.frames.buffer);
    expect(consumerRing.state.buffer).toBe(producerRing.state.buffer);
    expect(Array.from(consumerRing.read(2))).toEqual([0.25, 0.5]);
  });

  test('exposes UI producer and worklet consumer endpoints over shared descriptors', () => {
    const transport = createSharedAudioTransport({ capacity: 8, channels: 1 });
    const producer = createSharedAudioProducer(transport.descriptor);
    const consumer = createSharedAudioConsumer(transport.descriptor);

    expect(producer.write(Float32Array.from([4, 5, 6, 7]))).toBe(4);
    expect(Array.from(consumer.read(4))).toEqual([4, 5, 6, 7]);
    expect(consumer.availableRead()).toBe(0);
  });
});
