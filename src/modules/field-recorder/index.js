import { manifest } from './manifest.js';
import { FieldRecorderEngine } from './engine.js';

export { manifest };

export async function create(ctx = {}) {
  return {
    manifest,
    engine: new FieldRecorderEngine(ctx.audioContext),
    serialize() {
      return { id: manifest.id };
    },
  };
}
