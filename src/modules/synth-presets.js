// V11 Peer DAW/src/modules/synth-presets.js
// JSON-safe default/import/export synth preset bank.

function uniqueStrings(values = []) {
  return [
    ...new Set(
      Array.from(values)
        .map((value) => String(value).trim())
        .filter(Boolean)
    ),
  ];
}

export function normalizeSynthPreset(preset = {}) {
  if (!preset.synth) throw new Error('Synth preset requires a synth key');
  if (!preset.slug) throw new Error('Synth preset requires a slug');
  return {
    schemaVersion: Number(preset.schemaVersion || 1),
    type: 'v11.synth-preset',
    synth: String(preset.synth),
    slug: String(preset.slug),
    title: String(preset.title || preset.slug),
    category: String(preset.category || 'user'),
    description: String(preset.description || ''),
    tags: uniqueStrings(preset.tags),
    params: { ...(preset.params || {}) },
  };
}

export const DEFAULT_SYNTH_PRESETS = Object.freeze([
  normalizeSynthPreset({
    synth: 'analogsynth',
    slug: 'analog-warm-bass',
    title: 'Analog Warm Bass',
    category: 'typical',
    description: 'Round subtractive bass with sub oscillator weight and moderate filter envelope.',
    tags: ['bass', 'analog', 'subtractive'],
    params: {
      oscillatorMix: { saw: 0.52, square: 0.45, sub: 0.55 },
      cutoff: 720,
      resonance: 3.8,
      filterEnvelopeAmount: 1200,
      attack: 0.006,
      decay: 0.16,
      sustain: 0.58,
      release: 0.12,
      driveAmount: 0.42,
    },
  }),
  normalizeSynthPreset({
    synth: 'analogsynth',
    slug: 'analog-brass-pad',
    title: 'Analog Brass Pad',
    category: 'typical',
    description: 'Classic slow brass-pad contour for subtractive chords.',
    tags: ['pad', 'brass', 'analog'],
    params: {
      oscillatorMix: { saw: 0.7, square: 0.4, sub: 0.12 },
      cutoff: 1850,
      resonance: 5.5,
      filterEnvelopeAmount: 1700,
      attack: 0.08,
      decay: 0.42,
      sustain: 0.72,
      release: 0.85,
      driveAmount: 0.25,
    },
  }),
  normalizeSynthPreset({
    synth: 'wavetablesynth',
    slug: 'wavetable-soft-choir',
    title: 'Wavetable Soft Choir',
    category: 'typical',
    description: 'Hollow wavetable pad with a restrained low-pass for airy chords.',
    tags: ['pad', 'choir', 'wavetable'],
    params: {
      wavetable: 'hollow',
      morph: 0.38,
      tableSize: 48,
      cutoff: 3600,
      attack: 0.12,
      release: 1.1,
    },
  }),
  normalizeSynthPreset({
    synth: 'fmsynth',
    slug: 'fm-epiano-glass',
    title: 'FM Glass Electric Piano',
    category: 'epiano',
    description: 'Bright glassy electric piano style FM patch.',
    tags: ['electric-piano', 'fm', 'bell'],
    params: {
      carrierRatio: 1,
      modulatorRatio: 3,
      modulationIndex: 1.65,
      modulationMode: 'frequency',
      feedback: 0.08,
      attack: 0.006,
      release: 0.62,
    },
  }),
  normalizeSynthPreset({
    synth: 'analogsynth',
    slug: 'br-inspired-cs80-brass',
    title: 'Blade Runner Inspired CS Brass',
    category: 'vangelis-bladerunner',
    description:
      'Expressive cinematic brass lead/pad inspired by late-70s analog soundtrack colors.',
    tags: ['cinematic', 'brass', 'vangelis-inspired', 'blade-runner-inspired'],
    params: {
      oscillatorMix: { saw: 0.72, square: 0.42, sub: 0.08 },
      cutoff: 2400,
      resonance: 7,
      filterEnvelopeAmount: 2300,
      attack: 0.045,
      decay: 0.5,
      sustain: 0.76,
      release: 1.4,
      driveAmount: 0.18,
    },
  }),
  normalizeSynthPreset({
    synth: 'wavetablesynth',
    slug: 'br-inspired-rain-pad',
    title: 'Blade Runner Inspired Rain Pad',
    category: 'vangelis-bladerunner',
    description: 'Damp, glassy wavetable pad for neon-rain ambience.',
    tags: ['cinematic', 'pad', 'ambient', 'blade-runner-inspired'],
    params: {
      wavetable: 'glass',
      morph: 0.55,
      tableSize: 64,
      cutoff: 3100,
      attack: 0.25,
      release: 2.2,
    },
  }),
  normalizeSynthPreset({
    synth: 'analogsynth',
    slug: 'br-inspired-dream-lead',
    title: 'Blade Runner Inspired Dream Lead',
    category: 'vangelis-bladerunner',
    description: 'Soft high-resonance analog lead for slow melodic lines.',
    tags: ['cinematic', 'lead', 'analog', 'blade-runner-inspired'],
    params: {
      oscillatorMix: { saw: 0.58, square: 0.25, sub: 0.03 },
      cutoff: 3200,
      resonance: 10,
      filterEnvelopeAmount: 900,
      attack: 0.025,
      decay: 0.3,
      sustain: 0.84,
      release: 1.05,
      driveAmount: 0.12,
    },
  }),
  normalizeSynthPreset({
    synth: 'fmsynth',
    slug: 'experimental-r2d2-voice',
    title: 'Experimental Droid Chirp Voice',
    category: 'experimental',
    description: 'High-index FM bleep/chirp voice for expressive robot-like gestures.',
    tags: ['r2d2-like', 'robot', 'chirp', 'fm'],
    params: {
      carrierRatio: 2.1,
      modulatorRatio: 7.5,
      modulationIndex: 8.4,
      modulationMode: 'frequency',
      feedback: 0.22,
      attack: 0.002,
      release: 0.08,
    },
  }),
  normalizeSynthPreset({
    synth: 'fmsynth',
    slug: 'experimental-tie-fighter-laser',
    title: 'Experimental Twin Ion Laser',
    category: 'experimental',
    description: 'Aggressive FM zap/laser timbre for arcade and space combat punctuation.',
    tags: ['laser', 'space', 'sfx', 'fm'],
    params: {
      carrierRatio: 0.5,
      modulatorRatio: 9,
      modulationIndex: 11,
      modulationMode: 'frequency',
      feedback: 0.35,
      attack: 0.001,
      release: 0.18,
    },
  }),
  normalizeSynthPreset({
    synth: 'wavetablesynth',
    slug: 'experimental-cracking-noises',
    title: 'Experimental Cracking Noises',
    category: 'experimental',
    description: 'Brittle bright wavetable for crackle, sparks, ice, and broken-radio textures.',
    tags: ['noise', 'crackle', 'texture', 'wavetable'],
    params: {
      wavetable: 'bright',
      morph: 0.97,
      tableSize: 16,
      cutoff: 10800,
      attack: 0.001,
      release: 0.035,
    },
  }),
  normalizeSynthPreset({
    synth: 'wavetablesynth',
    slug: 'experimental-water-drop',
    title: 'Experimental Water Drop',
    category: 'experimental',
    description: 'Glassy plink for water drops and tiny resonant droplets.',
    tags: ['water', 'drop', 'plink', 'sfx'],
    params: {
      wavetable: 'glass',
      morph: 0.88,
      tableSize: 64,
      cutoff: 7600,
      attack: 0.001,
      release: 0.28,
    },
  }),
  normalizeSynthPreset({
    synth: 'wavetablesynth',
    slug: 'experimental-early-sci-fi-noise-bank',
    title: 'Experimental Early Sci-Fi Noise Bank',
    category: 'experimental',
    description: 'Vintage lab-equipment sci-fi bleeps, whines, and unstable oscillator colors.',
    tags: ['early-sci-fi', 'bleep', 'noise', 'retro'],
    params: {
      wavetable: 'hollow',
      morph: 0.82,
      tableSize: 24,
      cutoff: 9200,
      attack: 0.004,
      release: 0.16,
    },
  }),
]);

export function listSynthPresets({ synth, category, tags = [] } = {}) {
  const wantedTags = uniqueStrings(tags);
  return DEFAULT_SYNTH_PRESETS.filter((preset) => {
    if (synth && preset.synth !== synth) return false;
    if (category && preset.category !== category) return false;
    if (wantedTags.length && !wantedTags.every((tag) => preset.tags.includes(tag))) return false;
    return true;
  });
}

export function findSynthPreset(slug, presets = DEFAULT_SYNTH_PRESETS) {
  return presets.find((preset) => preset.slug === slug) || null;
}

export function exportSynthPresetBankJson(presets = DEFAULT_SYNTH_PRESETS) {
  return JSON.stringify({ schemaVersion: 1, type: 'v11.synth-preset-bank', presets }, null, 2);
}

export function importSynthPresetBankJson(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const presets = Array.isArray(parsed) ? parsed : parsed.presets || [];
  return presets.map(normalizeSynthPreset);
}
