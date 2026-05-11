export class SampleStream {
  constructor({ transport, chunkSize = 128 }) {
    this.transport = transport;
    this.chunkSize = chunkSize;
    this.data = new Float32Array(0);
    this.offset = 0;
  }

  load(channelData) {
    this.data = channelData;
    this.offset = 0;
  }

  pump() {
    if (this.offset >= this.data.length) return 0;

    const end = Math.min(this.offset + this.chunkSize, this.data.length);
    const written = this.transport.write(this.data.slice(this.offset, end));
    this.offset += written;
    return written;
  }
}
