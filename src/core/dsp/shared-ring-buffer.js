const READ_INDEX = 0;
const WRITE_INDEX = 1;
const AVAILABLE = 2;
const STATE_SLOTS = 3;

export class SharedFloat32RingBuffer {
  static READ_INDEX = READ_INDEX;
  static WRITE_INDEX = WRITE_INDEX;
  static AVAILABLE = AVAILABLE;

  static create(capacity) {
    return new SharedFloat32RingBuffer({
      capacity,
      stateBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * STATE_SLOTS),
      frameBuffer: new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * capacity),
    });
  }

  static fromDescriptor(descriptor) {
    return new SharedFloat32RingBuffer(descriptor);
  }

  constructor({ capacity, stateBuffer, frameBuffer }) {
    this.capacity = capacity;
    this.state = new Int32Array(stateBuffer);
    this.frames = new Float32Array(frameBuffer);
  }

  descriptor() {
    return {
      capacity: this.capacity,
      stateBuffer: this.state.buffer,
      frameBuffer: this.frames.buffer,
    };
  }

  availableRead() {
    return Atomics.load(this.state, AVAILABLE);
  }

  availableWrite() {
    return this.capacity - this.availableRead();
  }

  write(input) {
    let written = 0;

    for (const frame of input) {
      if (this.availableWrite() <= 0) break;

      const writeIndex = Atomics.load(this.state, WRITE_INDEX);
      this.frames[writeIndex] = frame;
      Atomics.store(this.state, WRITE_INDEX, (writeIndex + 1) % this.capacity);
      Atomics.add(this.state, AVAILABLE, 1);
      written += 1;
    }

    return written;
  }

  read(count) {
    const readable = Math.min(count, this.availableRead());
    const out = new Float32Array(readable);

    for (let i = 0; i < readable; i += 1) {
      const readIndex = Atomics.load(this.state, READ_INDEX);
      out[i] = this.frames[readIndex];
      Atomics.store(this.state, READ_INDEX, (readIndex + 1) % this.capacity);
      Atomics.sub(this.state, AVAILABLE, 1);
    }

    return out;
  }
}

export function createSharedAudioTransport({ capacity, channels = 1 }) {
  const ring = SharedFloat32RingBuffer.create(capacity * channels);

  return {
    descriptor: {
      ...ring.descriptor(),
      channels,
    },
    ring,
  };
}

export function createSharedAudioProducer(descriptor) {
  return SharedFloat32RingBuffer.fromDescriptor(descriptor);
}

export function createSharedAudioConsumer(descriptor) {
  return SharedFloat32RingBuffer.fromDescriptor(descriptor);
}
