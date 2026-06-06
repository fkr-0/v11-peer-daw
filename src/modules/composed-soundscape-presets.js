// V11 Peer DAW/src/modules/composed-soundscape-presets.js
// Composed source/effect/automation presets for moving experimental soundscapes.

function uniqueStrings(values = []) {
  return [
    ...new Set(
      Array.from(values)
        .map((value) => String(value).trim())
        .filter(Boolean)
    ),
  ];
}

export function normalizeComposedPreset(preset = {}) {
  if (!preset.slug) throw new Error('Composed preset requires a slug');
  return {
    schemaVersion: Number(preset.schemaVersion || 1),
    type: 'v11.composed-soundscape-preset',
    slug: String(preset.slug),
    title: String(preset.title || preset.slug),
    description: String(preset.description || ''),
    tags: uniqueStrings(preset.tags || ['soundscape']),
    sources: Array.from(preset.sources || []).map((source, index) => ({
      id: source.id || `source-${index + 1}`,
      moduleType: source.moduleType || source.type || 'wavetablesynth',
      preset: source.preset || '',
      role: source.role || 'sound-source',
      params: { ...(source.params || {}) },
    })),
    effectChain: Array.from(preset.effectChain || []).map((effect, index) => ({
      id: effect.id || `${effect.type || 'effect'}-${index + 1}`,
      type: effect.type || 'delay',
      params: { ...(effect.params || {}) },
    })),
    automation: {
      lengthBars: Number(preset.automation?.lengthBars || 16),
      lanes: Array.from(preset.automation?.lanes || []).map((lane) => ({
        targetModuleId: lane.targetModuleId || '',
        targetParam: lane.targetParam || lane.target || '',
        defaultValue: lane.defaultValue ?? 0,
        operators: Array.from(lane.operators || []).map((op) => ({ ...op })),
      })),
    },
    routing: Array.from(preset.routing || []).map((route) => ({ ...route })),
    notes: String(preset.notes || ''),
  };
}

function lane(targetModuleId, targetParam, defaultValue, operators) {
  return { targetModuleId, targetParam, defaultValue, operators };
}

export const COMPOSED_SOUNDSCAPE_PRESETS = Object.freeze([
  normalizeComposedPreset({
    slug: 'moving-dub-nebula',
    title: 'Moving Dub Nebula',
    description:
      'Long dub delays, resonant phaser motion, and drifting wet reverb for evolving nebula-like fields.',
    tags: ['dub', 'drone', 'atmosphere', 'feedback'],
    sources: [
      {
        id: 'nebula-pad',
        moduleType: 'wavetablesynth',
        preset: 'br-inspired-rain-pad',
        role: 'bed',
      },
      {
        id: 'nebula-chirps',
        moduleType: 'fmsynth',
        preset: 'experimental-r2d2-voice',
        role: 'sparkle',
      },
    ],
    effectChain: [
      {
        id: 'nebula-delay',
        type: 'delay',
        params: { time: 0.72, feedback: 0.62, wet: 0.5, tone: 3600 },
      },
      { id: 'nebula-dub', type: 'dubecho', params: { feedback: 0.76, wet: 0.58, tone: 1800 } },
      { id: 'nebula-phaser', type: 'phaser', params: { rate: 0.07, depth: 900, wet: 0.42 } },
      { id: 'nebula-reverb', type: 'reverb', params: { wet: 0.72, size: 0.86, tone: 2600 } },
    ],
    automation: {
      lengthBars: 32,
      lanes: [
        lane('nebula-delay', 'feedback', 0.62, [
          { type: 'lfo', startBeat: 0, endBeat: 128, min: 0.38, max: 0.88, cycles: 2 },
        ]),
        lane('nebula-dub', 'tone', 1800, [
          { type: 'linear', startBeat: 0, endBeat: 128, from: 900, to: 4200 },
        ]),
        lane('nebula-phaser', 'rate', 0.07, [
          { type: 'lfo', startBeat: 0, endBeat: 128, min: 0.025, max: 0.22, cycles: 5 },
        ]),
        lane('nebula-reverb', 'wet', 0.72, [
          { type: 'lfo', startBeat: 0, endBeat: 128, min: 0.45, max: 0.9, cycles: 1 },
        ]),
      ],
    },
    routing: [
      { from: 'nebula-pad', to: 'nebula-delay' },
      { from: 'nebula-chirps', to: 'nebula-delay' },
      { from: 'nebula-reverb', to: 'nebula-dub', feedback: true, gain: 0.18 },
    ],
  }),
  normalizeComposedPreset({
    slug: 'ion-storm-feedback-field',
    title: 'Ion Storm Feedback Field',
    description:
      'Aggressive laser FM source through pitch shift, flanger, grain delay, and feedback diffusion.',
    tags: ['laser', 'storm', 'feedback', 'experimental'],
    sources: [
      {
        id: 'ion-laser',
        moduleType: 'fmsynth',
        preset: 'experimental-tie-fighter-laser',
        role: 'exciter',
      },
      {
        id: 'ion-noise',
        moduleType: 'wavetablesynth',
        preset: 'experimental-cracking-noises',
        role: 'static',
      },
    ],
    effectChain: [
      { id: 'ion-pitch', type: 'pitchshift', params: { semitones: -7, mix: 0.62, window: 0.035 } },
      { id: 'ion-flanger', type: 'flanger', params: { depth: 0.012, rate: 0.18, wet: 0.7 } },
      {
        id: 'ion-grain',
        type: 'graindelay',
        params: { grainSize: 0.04, spray: 0.045, feedback: 0.64, wet: 0.72 },
      },
      { id: 'ion-reverb', type: 'reverb', params: { wet: 0.55, size: 0.72, tone: 5200 } },
    ],
    automation: {
      lengthBars: 16,
      lanes: [
        lane('ion-pitch', 'semitones', -7, [
          { type: 'step', startBeat: 0, value: -7 },
          { type: 'step', startBeat: 32, value: 5 },
        ]),
        lane('ion-grain', 'spray', 0.045, [
          { type: 'lfo', startBeat: 0, endBeat: 64, min: 0.01, max: 0.08, cycles: 7 },
        ]),
        lane('ion-flanger', 'rate', 0.18, [
          { type: 'linear', startBeat: 0, endBeat: 64, from: 0.04, to: 1.2 },
        ]),
        lane('ion-reverb', 'tone', 5200, [
          { type: 'lfo', startBeat: 0, endBeat: 64, min: 1400, max: 9000, cycles: 3 },
        ]),
      ],
    },
    routing: [{ from: 'ion-reverb', to: 'ion-grain', feedback: true, gain: 0.12 }],
  }),
  normalizeComposedPreset({
    slug: 'granular-water-memory',
    title: 'Granular Water Memory',
    description: 'Water-drop plinks smeared into grain delay and dub feedback trails.',
    tags: ['water', 'granular', 'ambient'],
    sources: [
      {
        id: 'water-drop',
        moduleType: 'wavetablesynth',
        preset: 'experimental-water-drop',
        role: 'droplet',
      },
    ],
    effectChain: [
      {
        id: 'water-grain',
        type: 'graindelay',
        params: { grainSize: 0.026, spray: 0.03, feedback: 0.52, wet: 0.68 },
      },
      { id: 'water-dub', type: 'dubecho', params: { feedback: 0.7, wet: 0.5, tone: 2400 } },
      { id: 'water-reverb', type: 'reverb', params: { wet: 0.82, size: 0.9, tone: 4200 } },
    ],
    automation: {
      lengthBars: 24,
      lanes: [
        lane('water-grain', 'grainSize', 0.026, [
          { type: 'lfo', startBeat: 0, endBeat: 96, min: 0.01, max: 0.12, cycles: 6 },
        ]),
        lane('water-dub', 'feedback', 0.7, [
          { type: 'lfo', startBeat: 0, endBeat: 96, min: 0.25, max: 0.86, cycles: 2 },
        ]),
        lane('water-reverb', 'size', 0.9, [
          { type: 'linear', startBeat: 0, endBeat: 96, from: 0.45, to: 0.95 },
        ]),
      ],
    },
    routing: [{ from: 'water-reverb', to: 'water-grain', feedback: true, gain: 0.08 }],
  }),
  normalizeComposedPreset({
    slug: 'cracked-radio-drone',
    title: 'Cracked Radio Drone',
    description: 'Crackle synth into beat repeat and narrow phaser for broken broadcast drones.',
    tags: ['radio', 'noise', 'drone'],
    sources: [
      {
        id: 'radio-crackle',
        moduleType: 'wavetablesynth',
        preset: 'experimental-cracking-noises',
        role: 'texture',
      },
    ],
    effectChain: [
      {
        id: 'radio-repeat',
        type: 'beatrepeat',
        params: { feedback: 0.72, wet: 0.62, repeat: 0.125 },
      },
      { id: 'radio-phaser', type: 'phaser', params: { rate: 0.11, depth: 650, wet: 0.55 } },
      {
        id: 'radio-delay',
        type: 'delay',
        params: { time: 0.43, feedback: 0.58, wet: 0.52, tone: 1200 },
      },
    ],
    automation: {
      lengthBars: 12,
      lanes: [
        lane('radio-repeat', 'repeat', 0.125, [
          { type: 'step', startBeat: 0, value: 0.125 },
          { type: 'step', startBeat: 24, value: 0.0625 },
        ]),
        lane('radio-phaser', 'depth', 650, [
          { type: 'lfo', startBeat: 0, endBeat: 48, min: 120, max: 1100, cycles: 4 },
        ]),
        lane('radio-delay', 'tone', 1200, [
          { type: 'lfo', startBeat: 0, endBeat: 48, min: 500, max: 3800, cycles: 2 },
        ]),
      ],
    },
    routing: [{ from: 'radio-delay', to: 'radio-repeat', feedback: true, gain: 0.1 }],
  }),
  normalizeComposedPreset({
    slug: 'blade-runner-rain-feedback-atmosphere',
    title: 'Blade Runner Rain Feedback Atmosphere',
    description:
      'Cinematic rain-pad and dream-lead sources through long dub/reverb feedback fields.',
    tags: ['cinematic', 'rain', 'drone', 'vangelis-inspired'],
    sources: [
      { id: 'rain-pad', moduleType: 'wavetablesynth', preset: 'br-inspired-rain-pad', role: 'pad' },
      {
        id: 'dream-lead',
        moduleType: 'analogsynth',
        preset: 'br-inspired-dream-lead',
        role: 'lead',
      },
    ],
    effectChain: [
      {
        id: 'rain-delay',
        type: 'delay',
        params: { time: 1.1, feedback: 0.56, wet: 0.46, tone: 2800 },
      },
      { id: 'rain-dub', type: 'dubecho', params: { feedback: 0.82, wet: 0.62, tone: 1900 } },
      { id: 'rain-reverb', type: 'reverb', params: { wet: 0.9, size: 0.95, tone: 3000 } },
    ],
    automation: {
      lengthBars: 64,
      lanes: [
        lane('rain-delay', 'time', 1.1, [
          { type: 'lfo', startBeat: 0, endBeat: 256, min: 0.66, max: 1.33, cycles: 2 },
        ]),
        lane('rain-dub', 'feedback', 0.82, [
          { type: 'lfo', startBeat: 0, endBeat: 256, min: 0.48, max: 0.9, cycles: 3 },
        ]),
        lane('rain-reverb', 'wet', 0.9, [
          { type: 'linear', startBeat: 0, endBeat: 256, from: 0.55, to: 0.95 },
        ]),
      ],
    },
    routing: [{ from: 'rain-reverb', to: 'rain-dub', feedback: true, gain: 0.16 }],
  }),
]);

export function findComposedPreset(slug, presets = COMPOSED_SOUNDSCAPE_PRESETS) {
  return presets.find((preset) => preset.slug === slug) || null;
}

export function exportComposedPresetBankJson(presets = COMPOSED_SOUNDSCAPE_PRESETS) {
  return JSON.stringify(
    { schemaVersion: 1, type: 'v11.composed-soundscape-preset-bank', presets },
    null,
    2
  );
}

export function importComposedPresetBankJson(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const presets = Array.isArray(parsed) ? parsed : parsed.presets || [];
  return presets.map(normalizeComposedPreset);
}
