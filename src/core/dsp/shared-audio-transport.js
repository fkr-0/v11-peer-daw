export const OverflowPolicy = Object.freeze({
  DROP_NEWEST: 'drop-newest',
  DROP_OLDEST: 'drop-oldest',
});

const READ_FRAME = 0;
const WRITE_FRAME = 1;
const AVAILABLE_FRAMES = 2;
const STATE_SLOTS = 3;

const defaultAtomics = {
  load: Atomics.load,
  store: Atomics.store,
  add: Atomics.add,
  sub: Atomics.sub,
};

export class SharedAudioTransport {
  static READ_FRAME = READ_FRAME;
  static WRITE_FRAME = WRITE_FRAME;
  static AVAILABLE_FRAMES = AVAILABLE_FRAMES;

  static create({
    frameCapacity,
    channels,
    overflowPolicy = OverflowPolicy.DROP_NEWEST,
    atomics = defaultAtomics,
  }) {
    return new SharedAudioTransport({
      frameCapacity,
      channels,
      overflowPolicy,
      atomics,
      stateBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * STATE_SLOTS),
      sampleBuffer: new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * frameCapacity * channels),
    });
  }

  static fromDescriptor(descriptor, options = {}) {
    return new SharedAudioTransport({
      ...descriptor,
      atomics: options.atomics ?? defaultAtomics,
    });
  }

  constructor({
    frameCapacity,
    channels,
    overflowPolicy = OverflowPolicy.DROP_NEWEST,
    atomics = defaultAtomics,
    stateBuffer,
    sampleBuffer,
  }) {
    this.frameCapacity = frameCapacity;
    this.channels = channels;
    this.overflowPolicy = overflowPolicy;
    this.atomics = atomics;
    this.state = new Int32Array(stateBuffer);
    this.samples = new Float32Array(sampleBuffer);
  }

  descriptor() {
    return {
      frameCapacity: this.frameCapacity,
      channels: this.channels,
      overflowPolicy: this.overflowPolicy,
      stateBuffer: this.state.buffer,
      sampleBuffer: this.samples.buffer,
    };
  }

  producer() {
    return SharedAudioTransport.fromDescriptor(this.descriptor(), { atomics: this.atomics });
  }

  consumer() {
    return SharedAudioTransport.fromDescriptor(this.descriptor(), { atomics: this.atomics });
  }

  availableRead() {
    return this.atomics.load(this.state, AVAILABLE_FRAMES);
  }

  availableWrite() {
    return this.frameCapacity - this.availableRead();
  }

  writeFrames(channels) {
    if (channels.length !== this.channels) {
      throw new Error(`Expected ${this.channels} channels, got ${channels.length}`);
    }

    const requestedFrames = Math.min(...channels.map((channel) => channel.length));
    return this.writeInterleaved(interleaveFrames(channels, requestedFrames));
  }

  writeInterleaved(input) {
    const requestedFrames = Math.floor(input.length / this.channels);
    const writableFrames = this.reserveWriteFrames(requestedFrames);
    if (writableFrames <= 0) return 0;

    const writeFrame = this.atomics.load(this.state, WRITE_FRAME);
    const firstChunk = Math.min(writableFrames, this.frameCapacity - writeFrame);
    this.copyInterleaved(input, 0, writeFrame, firstChunk);

    const remaining = writableFrames - firstChunk;
    if (remaining > 0) {
      this.copyInterleaved(input, firstChunk, 0, remaining);
    }

    this.atomics.store(this.state, WRITE_FRAME, (writeFrame + writableFrames) % this.frameCapacity);
    this.atomics.add(this.state, AVAILABLE_FRAMES, writableFrames);
    return writableFrames;
  }

  reserveWriteFrames(requestedFrames) {
    const free = this.availableWrite();
    if (requestedFrames <= free) return requestedFrames;

    if (this.overflowPolicy === OverflowPolicy.DROP_NEWEST) {
      return free;
    }

    const overflow = requestedFrames - free;
    this.dropOldest(overflow);
    return requestedFrames;
  }

  dropOldest(frameCount) {
    const available = this.availableRead();
    const dropped = Math.min(frameCount, available);
    if (dropped <= 0) return 0;

    const readFrame = this.atomics.load(this.state, READ_FRAME);
    this.atomics.store(this.state, READ_FRAME, (readFrame + dropped) % this.frameCapacity);
    this.atomics.sub(this.state, AVAILABLE_FRAMES, dropped);
    return dropped;
  }

  readInterleaved(frameCount) {
    const readableFrames = Math.min(frameCount, this.availableRead());
    const output = new Float32Array(readableFrames * this.channels);
    if (readableFrames <= 0) return output;

    const readFrame = this.atomics.load(this.state, READ_FRAME);
    const firstChunk = Math.min(readableFrames, this.frameCapacity - readFrame);
    this.copyOutInterleaved(output, 0, readFrame, firstChunk);

    const remaining = readableFrames - firstChunk;
    if (remaining > 0) {
      this.copyOutInterleaved(output, firstChunk, 0, remaining);
    }

    this.atomics.store(this.state, READ_FRAME, (readFrame + readableFrames) % this.frameCapacity);
    this.atomics.sub(this.state, AVAILABLE_FRAMES, readableFrames);
    return output;
  }

  copyInterleaved(input, inputFrameOffset, destinationFrameOffset, frameCount) {
    const sourceOffset = inputFrameOffset * this.channels;
    const destinationOffset = destinationFrameOffset * this.channels;
    const sampleCount = frameCount * this.channels;
    this.samples.set(input.subarray(sourceOffset, sourceOffset + sampleCount), destinationOffset);
  }

  copyOutInterleaved(output, outputFrameOffset, sourceFrameOffset, frameCount) {
    const sourceOffset = sourceFrameOffset * this.channels;
    const outputOffset = outputFrameOffset * this.channels;
    const sampleCount = frameCount * this.channels;
    output.set(this.samples.subarray(sourceOffset, sourceOffset + sampleCount), outputOffset);
  }
}

export class WorkerDecodePipeline {
  constructor({ producer, decode, chunkFrames = 128 }) {
    this.producer = producer;
    this.decode = decode;
    this.chunkFrames = chunkFrames;
  }

  async decodeAndStream(encoded) {
    const channels = await this.decode(encoded);
    let framesWritten = 0;
    const totalFrames = Math.min(...channels.map((channel) => channel.length));

    for (let offset = 0; offset < totalFrames; offset += this.chunkFrames) {
      const end = Math.min(offset + this.chunkFrames, totalFrames);
      const chunk = channels.map((channel) => channel.subarray(offset, end));
      framesWritten += this.producer.writeFrames(chunk);
    }

    return { framesWritten };
  }
}

export class WorkletPullScheduler {
  constructor({ consumer, channels }) {
    this.consumer = consumer;
    this.channels = channels;
  }

  pull(outputs, frameCount) {
    for (const output of outputs) output.fill(0);

    const interleaved = this.consumer.readInterleaved(frameCount);
    const pulledFrames = Math.floor(interleaved.length / this.channels);

    for (let frame = 0; frame < pulledFrames; frame += 1) {
      for (let channel = 0; channel < this.channels; channel += 1) {
        outputs[channel][frame] = interleaved[frame * this.channels + channel];
      }
    }

    return pulledFrames;
  }
}

export class WasmRingBufferView {
  static fromDescriptor(descriptor) {
    return new WasmRingBufferView(descriptor);
  }

  constructor(descriptor) {
    this.sampleBuffer = descriptor.sampleBuffer;
    this.stateBuffer = descriptor.stateBuffer;
    this.sampleOffsetBytes = 0;
    this.stateOffsetBytes = 0;
    this.sampleLength = descriptor.frameCapacity * descriptor.channels;
    this.stateLength = STATE_SLOTS;
  }
}

function interleaveFrames(channels, frameCount) {
  const interleaved = new Float32Array(frameCount * channels.length);

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      interleaved[frame * channels.length + channel] = channels[channel][frame];
    }
  }

  return interleaved;
}
