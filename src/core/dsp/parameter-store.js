export class ParameterStore {
  constructor(initialValues = {}, port = null) {
    this.values = new Map(Object.entries(initialValues));
    this.port = port;
  }

  get(name) {
    return this.values.get(name);
  }

  setValueAtTime(name, value, at = 0) {
    this.values.set(name, value);
    this.port?.postMessage?.({ type: 'param', name, value, at });
  }

  serialize() {
    return Object.fromEntries(this.values.entries());
  }
}
