const PROCESSOR_NAME = 'field-recorder';
const PROCESSOR_URL = './processor.worklet.js';

export class FieldRecorderEngine {
  constructor({ audioContext = null, workletRuntime = null } = {}) {
    this.audioContext = audioContext;
    this.workletRuntime = workletRuntime;
    this.output = null;
  }

  async start() {
    if (this.workletRuntime) {
      this.output = await this.workletRuntime.createNode(PROCESSOR_NAME, PROCESSOR_URL, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      return;
    }

    this.output = this.audioContext?.createGain?.() ?? null;

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
