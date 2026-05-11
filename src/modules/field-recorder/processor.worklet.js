class FieldRecorderProcessor extends AudioWorkletProcessor {
  process(_inputs, outputs) {
    const output = outputs[0];

    for (const channel of output) {
      channel.fill(0);
    }

    return true;
  }
}

registerProcessor('field-recorder', FieldRecorderProcessor);
