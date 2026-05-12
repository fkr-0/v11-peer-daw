// V11 Peer DAW/src/core/convertible-to-pianoroll.js
// Lightweight conversion contract for control generators that can become piano-roll clips.

export const CONVERTIBLE_TO_PIANOROLL = Symbol.for('v11.convertible-to-pianoroll');

export function isConvertibleToPianoRoll(module) {
  return Boolean(
    module?.[CONVERTIBLE_TO_PIANOROLL] && typeof module?.toPianoRollConfig === 'function'
  );
}

export function convertToPianoRollConfig(module) {
  if (!isConvertibleToPianoRoll(module)) {
    throw new TypeError('Module does not implement convertible-to-pianoroll');
  }
  return module.toPianoRollConfig();
}
