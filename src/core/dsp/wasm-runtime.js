export class WasmRuntime {
  constructor({ instantiate = WebAssembly.instantiate } = {}) {
    this.instantiate = instantiate;
  }

  async load(bytes, imports = {}) {
    const result = await this.instantiate(bytes, imports);
    return result.instance;
  }
}
