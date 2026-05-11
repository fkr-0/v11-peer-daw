import { ParameterStore } from '../../core/dsp/parameter-store.js';
import { SharedAudioTransport } from '../../core/dsp/shared-audio-transport.js';
import { FieldRecorderEngine } from './engine.js';
import { manifest } from './manifest.js';

export { manifest };

export async function create(ctx = {}) {
  const transportRuntime = (ctx.transportFactory ?? defaultTransportFactory)();
  const transportDescriptor = transportRuntime.descriptor();
  const transport = {
    runtime: transportRuntime,
    descriptor: transportDescriptor,
    producer: () => transportRuntime.producer(),
    consumer: () => transportRuntime.consumer(),
  };
  const params = new ParameterStore({ gain: 0.6 });
  const engine = new FieldRecorderEngine({
    audioContext: ctx.audioContext,
    workletRuntime: ctx.workletRuntime,
  });

  return {
    manifest,
    engine,
    params,
    transport,
    fileName: 'no sample loaded',
    async start() {
      await engine.start();
      engine.output?.port?.postMessage?.({ type: 'transport', descriptor: transport.descriptor });
      engine.output?.port?.postMessage?.({ type: 'params', values: params.serialize() });
    },
    serialize() {
      return { id: manifest.id, fileName: this.fileName, params: params.serialize() };
    },
    async dispose() {
      engine.disconnect();
    },
  };
}

function defaultTransportFactory() {
  return SharedAudioTransport.create({ frameCapacity: 65536, channels: 2 });
}
