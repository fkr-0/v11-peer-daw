export class Float32RingBuffer {
  constructor(capacity, storage = null) {
    this.capacity = capacity;
    this.buffer = storage instanceof Float32Array ? storage : new Float32Array(capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.size = 0;
  }

  write(frames) {
    let written = 0;

    for (const frame of frames) {
      if (this.size >= this.capacity) break;

      this.buffer[this.writeIndex] = frame;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.size += 1;
      written += 1;
    }

    return written;
  }

  read(count) {
    const out = new Float32Array(Math.min(count, this.size));

    for (let i = 0; i < out.length; i += 1) {
      out[i] = this.buffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.capacity;
      this.size -= 1;
    }

    return out;
  }
}
