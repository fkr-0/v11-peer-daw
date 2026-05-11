export class AudioWorkletRuntime {
  constructor(context) {
    this.context = context;
    this.registry = new Map();
  }

  async registerProcessor(name, url) {
    if (this.registry.has(name)) {
      return;
    }

    await this.context.audioWorklet.addModule(url);
    this.registry.set(name, url);
  }

  isRegistered(name) {
    return this.registry.has(name);
  }

  async createNode(name, url, options = {}) {
    await this.registerProcessor(name, url);

    const NodeCtor = this.context.AudioWorkletNode || globalThis.AudioWorkletNode;

    return new NodeCtor(this.context, name, options);
  }
}
