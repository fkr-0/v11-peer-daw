export class FieldRecorderEngine {
  constructor(context) {
    this.context = context;
    this.output = context?.createGain?.() ?? null;

    if (this.output?.gain) {
      this.output.gain.value = 0.6;
    }
  }

  connect(destination) {
    this.output?.connect?.(destination);
  }

  disconnect() {
    this.output?.disconnect?.();
  }
}
